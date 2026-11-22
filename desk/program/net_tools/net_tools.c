/*
 * net_tools - url-parse, http-status, mime-type
 * MIT License
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>
#include <ctype.h>

static const char *my_strcasestr(const char *haystack, const char *needle) {
    if (!*needle) return haystack;
    for (; *haystack; haystack++) {
        if (tolower((unsigned char)*haystack) == tolower((unsigned char)*needle)) {
            const char *h = haystack, *n = needle;
            while (*h && *n && tolower((unsigned char)*h) == tolower((unsigned char)*n)) {
                h++;
                n++;
            }
            if (!*n) return haystack;
        }
    }
    return NULL;
}

/* --- 1. url-parse --- */
static void do_url_parse(int argc, char **argv) {
    const char *url_str = NULL;
    for (int i = 1; i < argc; i++) {
        if (argv[i][0] != '-') url_str = argv[i];
    }
    if (!url_str) {
        static char line[2048];
        if (fgets(line, sizeof(line), stdin)) {
            size_t l = strlen(line);
            while (l > 0 && (line[l - 1] == '\n' || line[l - 1] == '\r')) line[--l] = '\0';
            url_str = line;
        }
    }
    if (!url_str || !*url_str) {
        fprintf(stderr, "Usage: url-parse <url>\n");
        return;
    }

    const char *p = url_str;
    char scheme[64] = {0};
    char host[256] = {0};
    char port[16] = {0};
    char path[1024] = "/";
    char query[2048] = {0};
    char fragment[256] = {0};

    /* Scheme */
    const char *colon_slash = strstr(p, "://");
    if (colon_slash) {
        size_t slen = colon_slash - p;
        if (slen < sizeof(scheme)) {
            strncpy(scheme, p, slen);
            scheme[slen] = '\0';
        }
        p = colon_slash + 3;
    }

    /* Auth / Userinfo */
    const char *at = strchr(p, '@');
    const char *slash = strchr(p, '/');
    const char *question = strchr(p, '?');
    const char *hash = strchr(p, '#');

    if (at && (!slash || at < slash) && (!question || at < question)) {
        p = at + 1;
    }

    /* Host & Port */
    const char *host_end = p;
    while (*host_end && *host_end != '/' && *host_end != '?' && *host_end != '#' && *host_end != ':') {
        host_end++;
    }
    size_t hlen = host_end - p;
    if (hlen < sizeof(host)) {
        strncpy(host, p, hlen);
        host[hlen] = '\0';
    }
    p = host_end;

    if (*p == ':') {
        p++;
        const char *port_end = p;
        while (*port_end && isdigit((unsigned char)*port_end)) port_end++;
        size_t plen = port_end - p;
        if (plen < sizeof(port)) {
            strncpy(port, p, plen);
            port[plen] = '\0';
        }
        p = port_end;
    }

    /* Path */
    if (*p == '/') {
        const char *path_end = p;
        while (*path_end && *path_end != '?' && *path_end != '#') path_end++;
        size_t plen = path_end - p;
        if (plen < sizeof(path)) {
            strncpy(path, p, plen);
            path[plen] = '\0';
        }
        p = path_end;
    }

    /* Query */
    if (*p == '?') {
        p++;
        const char *q_end = p;
        while (*q_end && *q_end != '#') q_end++;
        size_t qlen = q_end - p;
        if (qlen < sizeof(query)) {
            strncpy(query, p, qlen);
            query[qlen] = '\0';
        }
        p = q_end;
    }

    /* Fragment */
    if (*p == '#') {
        p++;
        strncpy(fragment, p, sizeof(fragment) - 1);
    }

    printf("Protocol:  %s\n", scheme[0] ? scheme : "(none)");
    printf("Host:      %s\n", host[0] ? host : "(none)");
    printf("Port:      %s\n", port[0] ? port : "(default)");
    printf("Path:      %s\n", path);
    printf("Query:     %s\n", query[0] ? query : "(none)");
    printf("Fragment:  %s\n", fragment[0] ? fragment : "(none)");

    if (query[0]) {
        printf("Query Parameters:\n");
        char qcopy[2048];
        strcpy(qcopy, query);
        char *tok = strtok(qcopy, "&");
        while (tok) {
            char *eq = strchr(tok, '=');
            if (eq) {
                *eq = '\0';
                printf("  %s = %s\n", tok, eq + 1);
            } else {
                printf("  %s\n", tok);
            }
            tok = strtok(NULL, "&");
        }
    }
}

/* --- 2. http-status --- */
typedef struct {
    int code;
    const char *name;
    const char *desc;
} http_status_t;

static const http_status_t status_codes[] = {
    {100, "Continue", "Server has received the request headers, client should continue"},
    {101, "Switching Protocols", "Requester asked server to switch protocols"},
    {200, "OK", "Standard response for successful HTTP requests"},
    {201, "Created", "The request has been fulfilled, creating a new resource"},
    {202, "Accepted", "Request accepted for processing, but processing not completed"},
    {204, "No Content", "Request processed successfully, returning no content"},
    {301, "Moved Permanently", "Resource has been assigned a new permanent URI"},
    {302, "Found", "Resource resides temporarily under a different URI"},
    {304, "Not Modified", "Resource has not been modified since specified in headers"},
    {307, "Temporary Redirect", "Target resource resides temporarily under different URI"},
    {308, "Permanent Redirect", "Target resource assigned a new permanent URI"},
    {400, "Bad Request", "Server cannot process request due to perceived client error"},
    {401, "Unauthorized", "Authentication is required and has failed or not provided"},
    {403, "Forbidden", "Server understood request but refuses to authorize it"},
    {404, "Not Found", "The requested resource could not be found"},
    {405, "Method Not Allowed", "Request method not supported for target resource"},
    {408, "Request Timeout", "Server timed out waiting for the request"},
    {409, "Conflict", "Request could not be processed because of conflict in state"},
    {418, "I'm a teapot", "Hyper Text Coffee Pot Control Protocol (RFC 2324)"},
    {422, "Unprocessable Entity", "Semantic errors prevented processing of request"},
    {429, "Too Many Requests", "User has sent too many requests in a given amount of time"},
    {500, "Internal Server Error", "Generic server error message when no specific one fits"},
    {501, "Not Implemented", "Server either does not recognize method or lacks ability"},
    {502, "Bad Gateway", "Server, while acting as gateway, received invalid response"},
    {503, "Service Unavailable", "Server cannot handle request due to overload or maintenance"},
    {504, "Gateway Timeout", "Server did not receive timely response from upstream server"},
    {0, NULL, NULL}
};

static void do_http_status(int argc, char **argv) {
    if (argc < 2 || strcmp(argv[1], "--all") == 0) {
        for (int i = 0; status_codes[i].code != 0; i++) {
            printf("%d %s: %s\n", status_codes[i].code, status_codes[i].name, status_codes[i].desc);
        }
        return;
    }

    int code = atoi(argv[1]);
    if (code > 0) {
        for (int i = 0; status_codes[i].code != 0; i++) {
            if (status_codes[i].code == code) {
                printf("%d %s - %s\n", status_codes[i].code, status_codes[i].name, status_codes[i].desc);
                return;
            }
        }
        fprintf(stderr, "Unknown HTTP status code: %d\n", code);
    } else {
        /* Search by name/text */
        const char *search = argv[1];
        int found = 0;
        for (int i = 0; status_codes[i].code != 0; i++) {
            if (my_strcasestr(status_codes[i].name, search) || my_strcasestr(status_codes[i].desc, search)) {
                printf("%d %s - %s\n", status_codes[i].code, status_codes[i].name, status_codes[i].desc);
                found = 1;
            }
        }
        if (!found) fprintf(stderr, "No matching HTTP status for '%s'\n", search);
    }
}

/* --- 3. mime-type --- */
typedef struct {
    const char *ext;
    const char *mime;
} mime_entry_t;

static const mime_entry_t mime_table[] = {
    {"html", "text/html"}, {"htm", "text/html"},
    {"css", "text/css"},
    {"js", "text/javascript"}, {"mjs", "text/javascript"},
    {"json", "application/json"},
    {"png", "image/png"},
    {"jpg", "image/jpeg"}, {"jpeg", "image/jpeg"},
    {"gif", "image/gif"},
    {"svg", "image/svg+xml"},
    {"webp", "image/webp"},
    {"ico", "image/x-icon"},
    {"pdf", "application/pdf"},
    {"zip", "application/zip"},
    {"tar", "application/x-tar"},
    {"gz", "application/gzip"},
    {"wasm", "application/wasm"},
    {"mp3", "audio/mpeg"},
    {"wav", "audio/wav"},
    {"ogg", "audio/ogg"},
    {"flac", "audio/flac"},
    {"mp4", "video/mp4"},
    {"webm", "video/webm"},
    {"txt", "text/plain"},
    {"xml", "application/xml"},
    {"csv", "text/csv"},
    {NULL, NULL}
};

static void do_mime_type(int argc, char **argv) {
    int reverse = 0;
    const char *query = NULL;

    for (int i = 1; i < argc; i++) {
        if (strcmp(argv[i], "-r") == 0 || strcmp(argv[i], "--reverse") == 0) reverse = 1;
        else if (argv[i][0] != '-') query = argv[i];
    }

    if (!query) {
        fprintf(stderr, "Usage: mime-type <extension|mime> [-r]\n");
        return;
    }

    if (reverse || strchr(query, '/')) {
        /* Lookup extensions for mime */
        int found = 0;
        for (int i = 0; mime_table[i].ext != NULL; i++) {
            if (strcasecmp(mime_table[i].mime, query) == 0) {
                printf(".%s\n", mime_table[i].ext);
                found = 1;
            }
        }
        if (!found) fprintf(stderr, "MIME type not found: %s\n", query);
    } else {
        if (*query == '.') query++;
        for (int i = 0; mime_table[i].ext != NULL; i++) {
            if (strcasecmp(mime_table[i].ext, query) == 0) {
                printf("%s\n", mime_table[i].mime);
                return;
            }
        }
        fprintf(stderr, "Extension not found: .%s\n", query);
    }
}

int main(int argc, char **argv) {
    char *prog = strrchr(argv[0], '/');
    prog = prog ? prog + 1 : argv[0];

    if (strstr(prog, "http-status") || strstr(prog, "httpstatus")) {
        do_http_status(argc, argv);
    } else if (strstr(prog, "mime-type") || strstr(prog, "mimetype")) {
        do_mime_type(argc, argv);
    } else {
        do_url_parse(argc, argv);
    }

    fflush(stdout);
    return 0;
}
