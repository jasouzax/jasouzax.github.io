/*
 * tools_catalog - tools help and command search directory
 * MIT License
 */
#define _GNU_SOURCE
#define _XOPEN_SOURCE 700
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>
#include <ctype.h>

typedef struct {
    const char *name;
    const char *category;
    const char *desc;
} tool_item_t;

static const tool_item_t catalog[] = {
    /* Group 1 */
    {"urlencode", "Encoding", "Percent-encodes URL query strings and path components"},
    {"urldecode", "Encoding", "Decodes percent-encoded URLs"},
    {"htmlencode", "Encoding", "Encodes characters to HTML entities"},
    {"htmldecode", "Encoding", "Decodes HTML entities back to characters"},
    {"rot13", "Encoding", "Rotates ASCII letters by 13 positions"},
    {"atob", "Encoding", "Decodes Base64 string to ASCII"},
    {"btoa", "Encoding", "Encodes ASCII string to Base64"},
    {"base32", "Encoding", "Base32 encoder and decoder"},
    {"caesar", "Encoding", "Caesar substitution cipher"},
    {"xxd", "Encoding", "Hex dump and reverse hex editor"},
    /* Group 2 */
    {"md5sum", "Hashing", "Computes MD5 message digest"},
    {"sha1sum", "Hashing", "Computes SHA-1 message digest"},
    {"sha256sum", "Hashing", "Computes SHA-256 message digest"},
    {"sha384sum", "Hashing", "Computes SHA-384 message digest"},
    {"sha512sum", "Hashing", "Computes SHA-512 message digest"},
    {"cksum", "Hashing", "POSIX standard CRC checksum and byte count"},
    {"crc32", "Hashing", "Computes CRC32 checksum"},
    /* Group 3 */
    {"jq", "Data", "Command-line JSON processor"},
    {"json-flatten", "Data", "Flattens nested JSON objects to dot-notation"},
    {"csv2json", "Data", "Converts CSV data to JSON array of objects"},
    {"json2csv", "Data", "Converts JSON array of objects to CSV"},
    {"tsv2json", "Data", "Converts TSV data to JSON array of objects"},
    {"json2tsv", "Data", "Converts JSON array of objects to TSV"},
    {"json2yaml", "Data", "Converts JSON data to YAML format"},
    {"ini2json", "Data", "Converts INI configuration to JSON format"},
    {"env2json", "Data", "Converts .env key-value pairs to JSON"},
    {"json2env", "Data", "Converts JSON object to .env format"},
    /* Group 4 */
    {"title-case", "Text", "Converts text to Title Case"},
    {"camel-case", "Text", "Converts text to camelCase"},
    {"snake-case", "Text", "Converts text to snake_case"},
    {"kebab-case", "Text", "Converts text to kebab-case"},
    {"slugify", "Text", "Converts arbitrary text into URL-safe slugs"},
    {"count-chars", "Text", "Character frequency statistics table"},
    {"charfreq", "Text", "Visual character frequency histogram"},
    {"lorem", "Text", "Lorem ipsum placeholder text generator"},
    {"str-repeat", "Text", "Repeats string or lines N times"},
    {"banner", "Text", "ASCII art block banner generator"},
    {"pig-latin", "Text", "Converts English text into Pig Latin"},
    {"anagram", "Text", "Checks whether two words or phrases are anagrams"},
    {"palindrome", "Text", "Tests whether input string is a palindrome"},
    /* Group 5 */
    {"numbase", "Math", "Arbitrary numeral base converter (bases 2-36)"},
    {"dec2bin", "Math", "Converts decimal number to binary"},
    {"dec2hex", "Math", "Converts decimal number to hexadecimal"},
    {"dec2oct", "Math", "Converts decimal number to octal"},
    {"hex2dec", "Math", "Converts hexadecimal number to decimal"},
    {"calc", "Math", "Arbitrary-precision calculator (bc / dc)"},
    {"random-bytes", "Math", "Generates cryptographic random bytes in hex"},
    {"fib", "Math", "Generates Fibonacci sequences"},
    {"gcd", "Math", "Computes greatest common divisor"},
    {"lcm", "Math", "Computes least common multiple"},
    {"stats", "Math", "Summary statistics (count, min, max, mean, median, stddev)"},
    {"matrix", "Math", "Matrix operations (transpose, trace, determinant)"},
    /* Group 6 */
    {"uuidgen", "Security", "Generates RFC 4122 compliant UUID v4"},
    {"nanoid", "Security", "Generates URL-safe compact NanoIDs"},
    {"pwgen", "Security", "Generates secure random passwords"},
    /* Group 7 */
    {"hex2rgb", "Color", "Converts hex color (#RRGGBB) to rgb() format"},
    {"rgb2hex", "Color", "Converts RGB values to #hex format"},
    {"color-mix", "Color", "Mixes two colors with custom ratio"},
    /* Group 8 */
    {"date-diff", "Units", "High-precision duration difference between dates"},
    {"bytes-human", "Units", "Converts byte count to human-readable format"},
    {"temp", "Units", "Converts temperature across Celsius, Fahrenheit, Kelvin"},
    {"unit", "Units", "Measurement unit converter across length, weight, volume"},
    /* Group 9 */
    {"url-parse", "Network", "Parses URL into scheme, host, port, path, query"},
    {"qr", "Network", "Generates terminal ASCII QR codes"},
    {"http-status", "Network", "HTTP status code reference dictionary"},
    {"mime-type", "Network", "MIME type and file extension lookup"},
    {"entropy", "Files", "Calculates Shannon entropy to detect encryption/compression"},
    {"detect-encoding", "Files", "Detects BOM and character encoding (UTF-8, ASCII)"},
    {"file-info", "Files", "Detailed file metadata and magic header preview"},
    /* Group 10 */
    {"escape-string", "Code", "Escapes strings for JSON, JS, Regex, or SQL"},
    {"unescape-string", "Code", "Unescapes strings for JSON, JS, Regex, or SQL"},
    {"count-tokens", "Code", "Estimates LLM token count (~4 chars/token)"},
    {"md2html", "Code", "Converts Markdown to HTML"},
    {"html2text", "Code", "Strips HTML tags and converts markup to plain text"},
    {"tools", "Help", "Desktop CLI tools directory and search"},
    {NULL, NULL, NULL}
};

static void print_tool(const tool_item_t *t) {
    printf("  %-16s [%-8s]  %s\n", t->name, t->category, t->desc);
}

int main(int argc, char **argv) {
    if (argc > 1 && (strcmp(argv[1], "search") == 0 || strcmp(argv[1], "-s") == 0)) {
        if (argc < 3) {
            fprintf(stderr, "Usage: tools search <query>\n");
            return 1;
        }
        const char *q = argv[2];
        printf("Tools matching '%s':\n\n", q);
        int found = 0;
        for (int i = 0; catalog[i].name != NULL; i++) {
            if (strcasestr(catalog[i].name, q) || strcasestr(catalog[i].desc, q) || strcasestr(catalog[i].category, q)) {
                print_tool(&catalog[i]);
                found++;
            }
        }
        if (!found) printf("  No matching tools found.\n");
        return 0;
    }

    if (argc > 1 && argv[1][0] != '-') {
        const char *name = argv[1];
        for (int i = 0; catalog[i].name != NULL; i++) {
            if (strcasecmp(catalog[i].name, name) == 0) {
                printf("\n  %s\n", catalog[i].name);
                printf("  Category:    %s\n", catalog[i].category);
                printf("  Description: %s\n\n", catalog[i].desc);
                return 0;
            }
        }
        fprintf(stderr, "Tool '%s' not found in catalog. Run 'tools' for directory.\n", name);
        return 1;
    }

    printf("=================================================================\n");
    printf("               JAZU DESKTOP COMMAND DIRECTORY                    \n");
    printf("=================================================================\n\n");

    const char *last_cat = "";
    for (int i = 0; catalog[i].name != NULL; i++) {
        if (strcmp(catalog[i].category, last_cat) != 0) {
            last_cat = catalog[i].category;
            printf("\n-- %s --\n", last_cat);
        }
        print_tool(&catalog[i]);
    }
    printf("\nTip: Run 'tools search <keyword>' or 'tools <toolname>'\n\n");
    fflush(stdout);
    return 0;
}
