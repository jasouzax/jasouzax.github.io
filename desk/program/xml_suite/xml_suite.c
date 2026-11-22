/*
 * xml_suite - xmlstarlet and xq (XML to JSON)
 * MIT License
 */
#define _XOPEN_SOURCE 700
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>
#include <ctype.h>

typedef struct xml_attr {
    char *name;
    char *value;
    struct xml_attr *next;
} xml_attr_t;

typedef struct xml_node {
    char *tag;
    char *text;
    xml_attr_t *attrs;
    struct xml_node *first_child;
    struct xml_node *next_sibling;
} xml_node_t;

static xml_node_t *create_node(const char *tag) {
    xml_node_t *n = calloc(1, sizeof(xml_node_t));
    if (tag) n->tag = strdup(tag);
    return n;
}

static void add_attr(xml_node_t *node, const char *name, const char *value) {
    xml_attr_t *a = calloc(1, sizeof(xml_attr_t));
    a->name = strdup(name);
    a->value = strdup(value);
    a->next = node->attrs;
    node->attrs = a;
}

static void add_child(xml_node_t *parent, xml_node_t *child) {
    if (!parent->first_child) {
        parent->first_child = child;
    } else {
        xml_node_t *cur = parent->first_child;
        while (cur->next_sibling) cur = cur->next_sibling;
        cur->next_sibling = child;
    }
}

static char *skip_whitespace(char *p) {
    while (*p && isspace((unsigned char)*p)) p++;
    return p;
}

static xml_node_t *parse_xml(char **ptr) {
    char *p = *ptr;
    xml_node_t *root = NULL;
    xml_node_t *cur_parent = NULL;
    xml_node_t *stack[256];
    int stack_top = -1;

    while (*p) {
        p = skip_whitespace(p);
        if (!*p) break;

        if (*p == '<') {
            p++;
            if (*p == '?') { /* XML declaration <?xml ... ?> */
                char *end = strstr(p, "?>");
                if (end) p = end + 2;
                continue;
            }
            if (*p == '!' && p[1] == '-' && p[2] == '-') { /* Comment <!-- ... --> */
                char *end = strstr(p, "-->");
                if (end) p = end + 3;
                continue;
            }
            if (*p == '!' && strncmp(p, "!DOCTYPE", 8) == 0) { /* DOCTYPE */
                char *end = strchr(p, '>');
                if (end) p = end + 1;
                continue;
            }
            if (*p == '/') { /* Closing tag </tag> */
                p++;
                char *end = strchr(p, '>');
                if (end) p = end + 1;
                if (stack_top >= 0) {
                    stack_top--;
                    cur_parent = (stack_top >= 0) ? stack[stack_top] : NULL;
                }
                continue;
            }

            /* Opening or self-closing tag <tag ... > or <tag ... /> */
            char *tag_start = p;
            while (*p && !isspace((unsigned char)*p) && *p != '>' && *p != '/') p++;
            size_t tag_len = p - tag_start;
            char tag[128];
            if (tag_len >= sizeof(tag)) tag_len = sizeof(tag) - 1;
            strncpy(tag, tag_start, tag_len);
            tag[tag_len] = '\0';

            xml_node_t *node = create_node(tag);
            if (!root) root = node;
            if (cur_parent) add_child(cur_parent, node);

            /* Parse attributes */
            int self_closing = 0;
            while (*p && *p != '>' && *p != '/') {
                p = skip_whitespace(p);
                if (*p == '>' || *p == '/' || !*p) break;
                char *attr_name_start = p;
                while (*p && *p != '=' && !isspace((unsigned char)*p) && *p != '>' && *p != '/') p++;
                size_t an_len = p - attr_name_start;
                char attr_name[128];
                if (an_len >= sizeof(attr_name)) an_len = sizeof(attr_name) - 1;
                strncpy(attr_name, attr_name_start, an_len);
                attr_name[an_len] = '\0';

                p = skip_whitespace(p);
                if (*p == '=') {
                    p++;
                    p = skip_whitespace(p);
                    char quote = *p;
                    if (quote == '"' || quote == '\'') {
                        p++;
                        char *val_start = p;
                        char *val_end = strchr(p, quote);
                        if (val_end) {
                            size_t v_len = val_end - val_start;
                            char val[512];
                            if (v_len >= sizeof(val)) v_len = sizeof(val) - 1;
                            strncpy(val, val_start, v_len);
                            val[v_len] = '\0';
                            add_attr(node, attr_name, val);
                            p = val_end + 1;
                        }
                    }
                }
            }

            p = skip_whitespace(p);
            if (*p == '/') {
                self_closing = 1;
                p++;
            }
            if (*p == '>') p++;

            if (!self_closing) {
                if (stack_top + 1 < 256) {
                    stack[++stack_top] = node;
                    cur_parent = node;
                }
            }
        } else {
            /* Text content */
            char *text_start = p;
            while (*p && *p != '<') p++;
            size_t t_len = p - text_start;
            while (t_len > 0 && isspace((unsigned char)text_start[t_len - 1])) t_len--;
            while (t_len > 0 && isspace((unsigned char)*text_start)) { text_start++; t_len--; }
            if (t_len > 0 && cur_parent) {
                char *txt = malloc(t_len + 1);
                strncpy(txt, text_start, t_len);
                txt[t_len] = '\0';
                cur_parent->text = txt;
            }
        }
    }

    *ptr = p;
    return root;
}

static void print_xml_formatted(const xml_node_t *node, int indent) {
    if (!node) return;
    for (int i = 0; i < indent * 2; i++) putchar(' ');
    printf("<%s", node->tag);
    for (xml_attr_t *a = node->attrs; a; a = a->next) {
        printf(" %s=\"%s\"", a->name, a->value);
    }

    if (!node->first_child && !node->text) {
        printf("/>\n");
    } else if (!node->first_child && node->text) {
        printf(">%s</%s>\n", node->text, node->tag);
    } else {
        printf(">\n");
        if (node->text) {
            for (int i = 0; i < (indent + 1) * 2; i++) putchar(' ');
            printf("%s\n", node->text);
        }
        for (xml_node_t *ch = node->first_child; ch; ch = ch->next_sibling) {
            print_xml_formatted(ch, indent + 1);
        }
        for (int i = 0; i < indent * 2; i++) putchar(' ');
        printf("</%s>\n", node->tag);
    }
}

static void print_node_to_json(const xml_node_t *node, int indent) {
    if (!node) return;
    printf("{\n");
    for (int i = 0; i < (indent + 1) * 2; i++) putchar(' ');
    printf("\"_tag\": \"%s\"", node->tag);

    for (xml_attr_t *a = node->attrs; a; a = a->next) {
        printf(",\n");
        for (int i = 0; i < (indent + 1) * 2; i++) putchar(' ');
        printf("\"@%s\": \"%s\"", a->name, a->value);
    }

    if (node->text) {
        printf(",\n");
        for (int i = 0; i < (indent + 1) * 2; i++) putchar(' ');
        printf("\"_text\": \"%s\"", node->text);
    }

    if (node->first_child) {
        printf(",\n");
        for (int i = 0; i < (indent + 1) * 2; i++) putchar(' ');
        printf("\"children\": [\n");
        for (xml_node_t *ch = node->first_child; ch; ch = ch->next_sibling) {
            for (int i = 0; i < (indent + 2) * 2; i++) putchar(' ');
            print_node_to_json(ch, indent + 2);
            if (ch->next_sibling) printf(",\n");
            else printf("\n");
        }
        for (int i = 0; i < (indent + 1) * 2; i++) putchar(' ');
        printf("]");
    }

    printf("\n");
    for (int i = 0; i < indent * 2; i++) putchar(' ');
    printf("}");
}

static void select_tag(const xml_node_t *node, const char *target) {
    if (!node) return;
    if (strcasecmp(node->tag, target) == 0) {
        if (node->text) printf("%s\n", node->text);
        else printf("<%s>\n", node->tag);
    }
    for (xml_node_t *ch = node->first_child; ch; ch = ch->next_sibling) {
        select_tag(ch, target);
    }
}

static void select_elements(const xml_node_t *node, const char *prefix) {
    if (!node) return;
    char path[512];
    snprintf(path, sizeof(path), "%s/%s", prefix, node->tag);
    printf("%s\n", path);
    for (xml_node_t *ch = node->first_child; ch; ch = ch->next_sibling) {
        select_elements(ch, path);
    }
}

static char *read_all(FILE *f) {
    size_t cap = 8192, len = 0;
    char *buf = malloc(cap);
    if (!buf) return NULL;
    size_t n;
    while ((n = fread(buf + len, 1, cap - len - 1, f)) > 0) {
        len += n;
        if (len + 1024 >= cap) {
            cap *= 2;
            buf = realloc(buf, cap);
        }
    }
    buf[len] = '\0';
    return buf;
}

int main(int argc, char **argv) {
    char *prog = strrchr(argv[0], '/');
    prog = prog ? prog + 1 : argv[0];

    int is_xq = (strstr(prog, "xq") != NULL);
    const char *sel_target = NULL;
    int list_elements = 0;
    const char *path = NULL;

    for (int i = 1; i < argc; i++) {
        if (strcmp(argv[i], "fo") == 0 || strcmp(argv[i], "format") == 0) {
            /* default format */
        } else if (strcmp(argv[i], "el") == 0 || strcmp(argv[i], "elements") == 0) {
            list_elements = 1;
        } else if ((strcmp(argv[i], "-v") == 0 || strcmp(argv[i], "--value") == 0) && i + 1 < argc) {
            sel_target = argv[++i];
        } else if (strcmp(argv[i], "sel") == 0 || strcmp(argv[i], "-t") == 0) {
            /* selector mode */
        } else if (argv[i][0] != '-') {
            path = argv[i];
        }
    }

    FILE *f = path ? fopen(path, "r") : stdin;
    if (!f) { perror(path ? path : "stdin"); return 1; }

    char *content = read_all(f);
    if (f != stdin) fclose(f);
    if (!content) return 1;

    char *ptr = content;
    xml_node_t *root = parse_xml(&ptr);
    if (!root) {
        fprintf(stderr, "Failed to parse XML\n");
        free(content);
        return 1;
    }

    if (is_xq) {
        print_node_to_json(root, 0);
        putchar('\n');
    } else if (list_elements) {
        select_elements(root, "");
    } else if (sel_target) {
        if (*sel_target == '/') sel_target++;
        char *last_slash = strrchr(sel_target, '/');
        if (last_slash) sel_target = last_slash + 1;
        select_tag(root, sel_target);
    } else {
        print_xml_formatted(root, 0);
    }

    free(content);
    fflush(stdout);
    return 0;
}
