/*
 * date_units - date-diff, bytes-human, temp, unit
 * MIT License
 */
#define _XOPEN_SOURCE 700
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>
#include <time.h>
#include <ctype.h>
#include <math.h>

/* --- 1. date-diff --- */
static time_t parse_date(const char *str) {
    /* Check if pure digits (timestamp) */
    char *end;
    long long ts = strtoll(str, &end, 10);
    if (*end == '\0') return (time_t)ts;

    struct tm tm = {0};
    /* Try YYYY-MM-DD */
    if (sscanf(str, "%d-%d-%d", &tm.tm_year, &tm.tm_mon, &tm.tm_mday) == 3) {
        tm.tm_year -= 1900;
        tm.tm_mon -= 1;
        tm.tm_isdst = -1;
        return mktime(&tm);
    }
    /* Try YYYY/MM/DD */
    if (sscanf(str, "%d/%d/%d", &tm.tm_year, &tm.tm_mon, &tm.tm_mday) == 3) {
        tm.tm_year -= 1900;
        tm.tm_mon -= 1;
        tm.tm_isdst = -1;
        return mktime(&tm);
    }
    return (time_t)0;
}

static void do_date_diff(int argc, char **argv) {
    const char *d1_str = NULL, *d2_str = NULL;
    for (int i = 1; i < argc; i++) {
        if (argv[i][0] != '-') {
            if (!d1_str) d1_str = argv[i];
            else if (!d2_str) d2_str = argv[i];
        }
    }
    if (!d1_str || !d2_str) {
        fprintf(stderr, "Usage: date-diff <date1|timestamp1> <date2|timestamp2>\n");
        return;
    }
    time_t t1 = parse_date(d1_str);
    time_t t2 = parse_date(d2_str);
    long long diff = (long long)difftime(t2, t1);
    long long abs_diff = diff < 0 ? -diff : diff;

    long long days = abs_diff / 86400;
    long long rem = abs_diff % 86400;
    long long hours = rem / 3600;
    rem %= 3600;
    long long minutes = rem / 60;
    long long seconds = rem % 60;

    printf("Difference: %lld seconds (%s%lld days, %lld hours, %lld minutes, %lld seconds)\n",
           diff, diff < 0 ? "-" : "", days, hours, minutes, seconds);
}

/* --- 2. bytes-human --- */
static void do_bytes_human(int argc, char **argv) {
    int si = 0; /* default IEC 1024 */
    int reverse = 0;
    const char *input = NULL;

    for (int i = 1; i < argc; i++) {
        if (strcmp(argv[i], "-s") == 0 || strcmp(argv[i], "--si") == 0) si = 1;
        else if (strcmp(argv[i], "-i") == 0 || strcmp(argv[i], "--iec") == 0) si = 0;
        else if (strcmp(argv[i], "-r") == 0 || strcmp(argv[i], "--reverse") == 0) reverse = 1;
        else if (argv[i][0] != '-') input = argv[i];
    }

    if (!input) {
        static char line[128];
        if (fgets(line, sizeof(line), stdin)) {
            size_t l = strlen(line);
            while (l > 0 && (line[l - 1] == '\n' || line[l - 1] == '\r')) line[--l] = '\0';
            input = line;
        }
    }
    if (!input || !*input) return;

    if (reverse) {
        char *end;
        double val = strtod(input, &end);
        while (*end && isspace((unsigned char)*end)) end++;
        double multiplier = 1.0;
        if (strncasecmp(end, "k", 1) == 0) multiplier = si ? 1e3 : 1024.0;
        else if (strncasecmp(end, "m", 1) == 0) multiplier = si ? 1e6 : 1048576.0;
        else if (strncasecmp(end, "g", 1) == 0) multiplier = si ? 1e9 : 1073741824.0;
        else if (strncasecmp(end, "t", 1) == 0) multiplier = si ? 1e12 : 1099511627776.0;
        else if (strncasecmp(end, "p", 1) == 0) multiplier = si ? 1e15 : 1125899906842624.0;

        printf("%.0f\n", val * multiplier);
    } else {
        double bytes = atof(input);
        double base = si ? 1000.0 : 1024.0;
        const char *const units_iec[] = {"B", "KiB", "MiB", "GiB", "TiB", "PiB"};
        const char *const units_si[] = {"B", "KB", "MB", "GB", "TB", "PB"};
        const char *const *units = si ? units_si : units_iec;

        int unit_idx = 0;
        while (bytes >= base && unit_idx < 5) {
            bytes /= base;
            unit_idx++;
        }
        if (unit_idx == 0) {
            printf("%.0f %s\n", bytes, units[unit_idx]);
        } else {
            printf("%.2f %s\n", bytes, units[unit_idx]);
        }
    }
}

/* --- 3. temp --- */
static void do_temp(int argc, char **argv) {
    double val = 0.0;
    char scale = 'C';
    int has_val = 0;

    for (int i = 1; i < argc; i++) {
        if (strcmp(argv[i], "-c") == 0 && i + 1 < argc) { val = atof(argv[++i]); scale = 'C'; has_val = 1; }
        else if (strcmp(argv[i], "-f") == 0 && i + 1 < argc) { val = atof(argv[++i]); scale = 'F'; has_val = 1; }
        else if (strcmp(argv[i], "-k") == 0 && i + 1 < argc) { val = atof(argv[++i]); scale = 'K'; has_val = 1; }
        else if (argv[i][0] != '-') {
            if (!has_val) {
                val = atof(argv[i]);
                has_val = 1;
            } else {
                scale = (char)toupper((unsigned char)argv[i][0]);
            }
        }
    }

    if (!has_val) {
        fprintf(stderr, "Usage: temp <value> [C|F|K]\n");
        return;
    }

    double c = 0, f = 0, k = 0;
    if (scale == 'C') {
        c = val;
        f = c * 9.0 / 5.0 + 32.0;
        k = c + 273.15;
    } else if (scale == 'F') {
        f = val;
        c = (f - 32.0) * 5.0 / 9.0;
        k = c + 273.15;
    } else if (scale == 'K') {
        k = val;
        c = k - 273.15;
        f = c * 9.0 / 5.0 + 32.0;
    }

    printf("Celsius:    %.2f °C\n", c);
    printf("Fahrenheit: %.2f °F\n", f);
    printf("Kelvin:     %.2f K\n", k);
}

/* --- 4. unit --- */
typedef struct {
    const char *name;
    const char *type;
    double to_base;
} unit_def_t;

static const unit_def_t unit_table[] = {
    /* Length (base: meter) */
    {"m", "len", 1.0}, {"meter", "len", 1.0}, {"meters", "len", 1.0},
    {"km", "len", 1000.0}, {"kilometer", "len", 1000.0},
    {"cm", "len", 0.01}, {"centimeter", "len", 0.01},
    {"mm", "len", 0.001}, {"millimeter", "len", 0.001},
    {"in", "len", 0.0254}, {"inch", "len", 0.0254}, {"inches", "len", 0.0254},
    {"ft", "len", 0.3048}, {"foot", "len", 0.3048}, {"feet", "len", 0.3048},
    {"yd", "len", 0.9144}, {"yard", "len", 0.9144},
    {"mi", "len", 1609.344}, {"mile", "len", 1609.344}, {"miles", "len", 1609.344},
    /* Weight (base: kg) */
    {"kg", "wt", 1.0}, {"kilogram", "wt", 1.0},
    {"g", "wt", 0.001}, {"gram", "wt", 0.001},
    {"mg", "wt", 0.000001}, {"milligram", "wt", 0.000001},
    {"lb", "wt", 0.45359237}, {"pound", "wt", 0.45359237}, {"pounds", "wt", 0.45359237},
    {"oz", "wt", 0.028349523125}, {"ounce", "wt", 0.028349523125},
    /* Volume (base: liter) */
    {"l", "vol", 1.0}, {"liter", "vol", 1.0}, {"liters", "vol", 1.0},
    {"ml", "vol", 0.001}, {"milliliter", "vol", 0.001},
    {"gal", "vol", 3.785411784}, {"gallon", "vol", 3.785411784},
    {"qt", "vol", 0.946352946}, {"quart", "vol", 0.946352946},
    {"pt", "vol", 0.473176473}, {"pint", "vol", 0.473176473},
    {"cup", "vol", 0.2365882365}, {"cups", "vol", 0.2365882365},
    {"floz", "vol", 0.0295735295625},
    {NULL, NULL, 0}
};

static const unit_def_t *find_unit(const char *name) {
    for (int i = 0; unit_table[i].name != NULL; i++) {
        if (strcasecmp(unit_table[i].name, name) == 0) return &unit_table[i];
    }
    return NULL;
}

static void do_unit(int argc, char **argv) {
    if (argc < 4) {
        fprintf(stderr, "Usage: unit <value> <from_unit> <to_unit>\n");
        return;
    }

    double val = atof(argv[1]);
    const unit_def_t *from = find_unit(argv[2]);
    const unit_def_t *to = find_unit(argv[3]);

    if (!from) {
        fprintf(stderr, "Unknown unit: %s\n", argv[2]);
        return;
    }
    if (!to) {
        fprintf(stderr, "Unknown unit: %s\n", argv[3]);
        return;
    }
    if (strcmp(from->type, to->type) != 0) {
        fprintf(stderr, "Incompatible units: %s (%s) and %s (%s)\n", argv[2], from->type, argv[3], to->type);
        return;
    }

    double base_val = val * from->to_base;
    double result = base_val / to->to_base;
    printf("%g %s\n", result, to->name);
}

int main(int argc, char **argv) {
    char *prog = strrchr(argv[0], '/');
    prog = prog ? prog + 1 : argv[0];

    if (strstr(prog, "date-diff") || strstr(prog, "datediff")) {
        do_date_diff(argc, argv);
    } else if (strstr(prog, "bytes-human") || strstr(prog, "byteshuman")) {
        do_bytes_human(argc, argv);
    } else if (strstr(prog, "temp")) {
        do_temp(argc, argv);
    } else if (strstr(prog, "unit")) {
        do_unit(argc, argv);
    } else {
        do_date_diff(argc, argv);
    }

    fflush(stdout);
    return 0;
}
