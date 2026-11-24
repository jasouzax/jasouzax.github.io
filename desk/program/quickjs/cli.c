/* Browser CLI for the upstream QuickJS engine. MIT, Jazu contributors. */
#include "quickjs.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct rejection {
    JSValue promise, reason;
    struct rejection *next;
} rejection;
static rejection *rejections;
static void track_rejection(JSContext *ctx, JSValueConst promise, JSValueConst reason, JS_BOOL handled, void *opaque) {
    rejection **entry = &rejections;
    while (*entry && JS_VALUE_GET_PTR((*entry)->promise) != JS_VALUE_GET_PTR(promise)) entry = &(*entry)->next;
    if (handled && *entry) {
        rejection *old = *entry;
        *entry = old->next;
        JS_FreeValue(ctx, old->promise); JS_FreeValue(ctx, old->reason); free(old);
    } else if (!handled && !*entry) {
        *entry = malloc(sizeof(rejection));
        if (!*entry) return;
        **entry = (rejection){ JS_DupValue(ctx, promise), JS_DupValue(ctx, reason), NULL };
    }
}

static JSValue print(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv) {
    for (int i = 0; i < argc; i++) {
        const char *text = JS_ToCString(ctx, argv[i]);
        if (!text) return JS_EXCEPTION;
        if (i) putchar(' ');
        fputs(text, stdout);
        JS_FreeCString(ctx, text);
    }
    putchar('\n');
    return JS_UNDEFINED;
}

static char *read_file(const char *path, size_t *len) {
    FILE *fp = !strcmp(path, "-") ? stdin : fopen(path, "rb");
    if (!fp) return NULL;
    size_t cap = 4096, used = 0;
    char *buf = malloc(cap);
    if (!buf) { if (fp != stdin) fclose(fp); return NULL; }
    for (;;) {
        if (used + 1 == cap) {
            cap *= 2;
            char *next = realloc(buf, cap);
            if (!next) { free(buf); if (fp != stdin) fclose(fp); return NULL; }
            buf = next;
        }
        size_t n = fread(buf + used, 1, cap - used - 1, fp);
        used += n;
        if (!n) break;
    }
    int failed = ferror(fp);
    if (fp != stdin) fclose(fp);
    if (failed) { free(buf); return NULL; }
    buf[used] = 0; *len = used;
    return buf;
}

static JSValue read_text(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv) {
    const char *path = JS_ToCString(ctx, argc ? argv[0] : JS_UNDEFINED);
    if (!path) return JS_EXCEPTION;
    size_t len; char *text = read_file(path, &len);
    JS_FreeCString(ctx, path);
    if (!text) return JS_ThrowTypeError(ctx, "Cannot read file");
    JSValue value = JS_NewStringLen(ctx, text, len);
    free(text); return value;
}

static JSValue write_text(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv) {
    if (argc < 2) return JS_ThrowTypeError(ctx, "writeFile(path, text)");
    const char *path = JS_ToCString(ctx, argv[0]);
    size_t len; const char *text = JS_ToCStringLen(ctx, &len, argv[1]);
    FILE *fp = path && text ? fopen(path, "wb") : NULL;
    int ok = fp && fwrite(text, 1, len, fp) == len;
    if (fp && fclose(fp)) ok = 0;
    JS_FreeCString(ctx, path); JS_FreeCString(ctx, text);
    return ok ? JS_UNDEFINED : JS_ThrowTypeError(ctx, "Cannot write file");
}

static JSModuleDef *load_module(JSContext *ctx, const char *name, void *opaque) {
    size_t len; char *text = read_file(name, &len);
    if (!text) { JS_ThrowReferenceError(ctx, "Cannot read module '%s'", name); return NULL; }
    JSValue value = JS_Eval(ctx, text, len, name, JS_EVAL_TYPE_MODULE | JS_EVAL_FLAG_COMPILE_ONLY);
    free(text);
    if (JS_IsException(value)) return NULL;
    JSModuleDef *module = JS_VALUE_GET_PTR(value);
    JS_FreeValue(ctx, value);
    return module;
}

static void report(JSContext *ctx) {
    JSValue error = JS_GetException(ctx);
    const char *text = JS_ToCString(ctx, error);
    fprintf(stderr, "%s\n", text ? text : "JavaScript exception");
    JS_FreeCString(ctx, text);
    JSValue stack = JS_GetPropertyStr(ctx, error, "stack");
    if (!JS_IsUndefined(stack)) {
        text = JS_ToCString(ctx, stack);
        if (text) fputs(text, stderr);
        JS_FreeCString(ctx, text);
    }
    JS_FreeValue(ctx, stack); JS_FreeValue(ctx, error);
}

int main(int argc, char **argv) {
    int module = 0, pos = 1, eval = 0;
    if (argc > 1 && !strcmp(argv[1], "--version")) { puts("QuickJS " CONFIG_VERSION " (Desk CLI)"); return 0; }
    if (argc > 1 && !strcmp(argv[1], "--help")) {
        puts("Usage: qjs [-m] [-e code | file | -] [args...]\nGlobals: print, console.log, scriptArgs, readFile, writeFile\nLocal ES modules supported; no Node.js or browser APIs."); return 0;
    }
    if (pos < argc && !strcmp(argv[pos], "-m")) { module = 1; pos++; }
    if (pos < argc && !strcmp(argv[pos], "-e")) { eval = 1; pos++; }
    if (eval && pos == argc) { fputs("qjs: -e requires code\n", stderr); return 2; }
    const char *name = pos < argc ? argv[pos] : "-";
    if (!eval && strcmp(name, "-") && name[0] == '-') { fputs("qjs: unknown option\n", stderr); return 2; }
    size_t len = eval ? strlen(name) : 0;
    char *source = eval ? NULL : read_file(name, &len);
    if (!eval && !source) { perror(name); return 1; }
    if (!eval && strlen(name) >= 4 && !strcmp(name + strlen(name) - 4, ".mjs")) module = 1;
    JSRuntime *rt = JS_NewRuntime();
    if (!rt) { free(source); return 1; }
    JSContext *ctx = JS_NewContext(rt);
    if (!ctx) { JS_FreeRuntime(rt); free(source); return 1; }
    JS_SetModuleLoaderFunc(rt, NULL, load_module, NULL);
    JS_SetHostPromiseRejectionTracker(rt, track_rejection, NULL);
    JSValue global = JS_GetGlobalObject(ctx), console = JS_NewObject(ctx), args = JS_NewArray(ctx);
    JS_SetPropertyStr(ctx, global, "print", JS_NewCFunction(ctx, print, "print", 1));
    JS_SetPropertyStr(ctx, console, "log", JS_NewCFunction(ctx, print, "log", 1));
    JS_SetPropertyStr(ctx, global, "console", console);
    JS_SetPropertyStr(ctx, global, "readFile", JS_NewCFunction(ctx, read_text, "readFile", 1));
    JS_SetPropertyStr(ctx, global, "writeFile", JS_NewCFunction(ctx, write_text, "writeFile", 2));
    for (int i = pos; i < argc; i++) JS_SetPropertyUint32(ctx, args, i - pos, JS_NewString(ctx, argv[i]));
    JS_SetPropertyStr(ctx, global, "scriptArgs", args);
    JS_FreeValue(ctx, global);
    JSValue value = JS_Eval(ctx, eval ? name : source, len, eval ? "<eval>" : name, module ? JS_EVAL_TYPE_MODULE : JS_EVAL_TYPE_GLOBAL);
    int status = JS_IsException(value);
    if (status) report(ctx);
    JS_FreeValue(ctx, value); free(source);
    JSContext *job_ctx;
    while (!status && JS_IsJobPending(rt)) {
        if (JS_ExecutePendingJob(rt, &job_ctx) < 0) { report(job_ctx); status = 1; }
    }
    while (rejections) {
        rejection *old = rejections;
        rejections = old->next;
        JS_Throw(ctx, JS_DupValue(ctx, old->reason)); report(ctx); status = 1;
        JS_FreeValue(ctx, old->promise); JS_FreeValue(ctx, old->reason); free(old);
    }
    JS_FreeContext(ctx); JS_FreeRuntime(rt);
    return status;
}
