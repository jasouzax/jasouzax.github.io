/*
 * math_suite - Math tools: fib, gcd, lcm, stats, matrix
 * MIT License
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <math.h>
#include <stdint.h>

/* GCD & LCM */
static long long compute_gcd(long long a, long long b) {
    if (a < 0) a = -a;
    if (b < 0) b = -b;
    while (b != 0) {
        long long t = b;
        b = a % b;
        a = t;
    }
    return a;
}

static long long compute_lcm(long long a, long long b) {
    if (a == 0 || b == 0) return 0;
    long long g = compute_gcd(a, b);
    return (a / g) * b;
}

static void do_gcd_lcm(int is_lcm, int argc, char **argv) {
    long long result = 0;
    int first = 1;
    for (int i = 1; i < argc; i++) {
        if (argv[i][0] == '-') continue;
        long long val = atoll(argv[i]);
        if (first) {
            result = val;
            first = 0;
        } else {
            result = is_lcm ? compute_lcm(result, val) : compute_gcd(result, val);
        }
    }
    if (first) {
        /* Read from stdin */
        long long val;
        while (scanf("%lld", &val) == 1) {
            if (first) {
                result = val;
                first = 0;
            } else {
                result = is_lcm ? compute_lcm(result, val) : compute_gcd(result, val);
            }
        }
    }
    printf("%lld\n", result);
}

/* Fibonacci */
static void do_fib(int argc, char **argv) {
    int n = 10;
    int single = 0;
    for (int i = 1; i < argc; i++) {
        if (strcmp(argv[i], "-s") == 0 || strcmp(argv[i], "--single") == 0) single = 1;
        else if (argv[i][0] != '-') n = atoi(argv[i]);
    }
    if (n <= 0) n = 1;
    if (n > 93) n = 93; /* fits in unsigned long long */

    unsigned long long a = 0, b = 1;
    if (single) {
        for (int i = 0; i < n; i++) {
            unsigned long long next = a + b;
            a = b;
            b = next;
        }
        printf("%llu\n", a);
    } else {
        for (int i = 0; i < n; i++) {
            printf("%llu%s", a, (i + 1 < n) ? " " : "\n");
            unsigned long long next = a + b;
            a = b;
            b = next;
        }
    }
}

/* Summary Statistics */
static int cmp_double(const void *a, const void *b) {
    double da = *(const double *)a, db = *(const double *)b;
    return (da > db) - (da < db);
}

static void do_stats(int argc, char **argv) {
    size_t cap = 256, count = 0;
    double *nums = malloc(cap * sizeof(double));
    if (!nums) return;

    for (int i = 1; i < argc; i++) {
        if (argv[i][0] == '-') continue;
        char *end;
        double val = strtod(argv[i], &end);
        if (end != argv[i]) {
            if (count >= cap) {
                cap *= 2;
                nums = realloc(nums, cap * sizeof(double));
            }
            nums[count++] = val;
        }
    }

    if (count == 0) {
        double val;
        while (scanf("%lf", &val) == 1) {
            if (count >= cap) {
                cap *= 2;
                nums = realloc(nums, cap * sizeof(double));
            }
            nums[count++] = val;
        }
    }

    if (count == 0) {
        free(nums);
        return;
    }

    double sum = 0, min_val = nums[0], max_val = nums[0];
    for (size_t i = 0; i < count; i++) {
        sum += nums[i];
        if (nums[i] < min_val) min_val = nums[i];
        if (nums[i] > max_val) max_val = nums[i];
    }
    double mean = sum / count;

    qsort(nums, count, sizeof(double), cmp_double);
    double median;
    if (count % 2 == 1) {
        median = nums[count / 2];
    } else {
        median = (nums[count / 2 - 1] + nums[count / 2]) / 2.0;
    }

    double var_sum = 0;
    for (size_t i = 0; i < count; i++) {
        double diff = nums[i] - mean;
        var_sum += diff * diff;
    }
    double variance = (count > 1) ? var_sum / (count - 1) : 0.0;
    double stddev = sqrt(variance);

    printf("Count:    %zu\n", count);
    printf("Sum:      %g\n", sum);
    printf("Min:      %g\n", min_val);
    printf("Max:      %g\n", max_val);
    printf("Mean:     %g\n", mean);
    printf("Median:   %g\n", median);
    printf("Variance: %g\n", variance);
    printf("StdDev:   %g\n", stddev);

    free(nums);
}

/* Matrix Operations */
static double compute_det(double *m, int n) {
    if (n == 1) return m[0];
    if (n == 2) return m[0] * m[3] - m[1] * m[2];

    double det = 0;
    double *sub = malloc((n - 1) * (n - 1) * sizeof(double));
    if (!sub) return 0;

    for (int col = 0; col < n; col++) {
        int subi = 0;
        for (int i = 1; i < n; i++) {
            int subj = 0;
            for (int j = 0; j < n; j++) {
                if (j == col) continue;
                sub[subi * (n - 1) + subj] = m[i * n + j];
                subj++;
            }
            subi++;
        }
        double sign = (col % 2 == 0) ? 1.0 : -1.0;
        det += sign * m[col] * compute_det(sub, n - 1);
    }
    free(sub);
    return det;
}

static void do_matrix(int argc, char **argv) {
    const char *op = "transpose";
    for (int i = 1; i < argc; i++) {
        if (argv[i][0] != '-') {
            op = argv[i];
            break;
        }
    }

    /* Read matrix from stdin: lines with numbers */
    size_t rows = 0, cols = 0;
    size_t cap = 64;
    double *mat = malloc(cap * sizeof(double));
    if (!mat) return;

    char line[1024];
    while (fgets(line, sizeof(line), stdin)) {
        size_t line_cols = 0;
        char *ptr = line;
        while (*ptr) {
            char *end;
            double v = strtod(ptr, &end);
            if (end == ptr) break;
            if (rows * cols + line_cols >= cap) {
                cap *= 2;
                mat = realloc(mat, cap * sizeof(double));
            }
            mat[rows * (cols > 0 ? cols : 100) + line_cols] = v;
            line_cols++;
            ptr = end;
        }
        if (line_cols > 0) {
            if (cols == 0) cols = line_cols;
            rows++;
        }
    }

    if (rows == 0 || cols == 0) {
        free(mat);
        return;
    }

    if (strcmp(op, "trace") == 0) {
        size_t n = rows < cols ? rows : cols;
        double tr = 0;
        for (size_t i = 0; i < n; i++) {
            tr += mat[i * cols + i];
        }
        printf("%g\n", tr);
    } else if (strcmp(op, "det") == 0 || strcmp(op, "determinant") == 0) {
        if (rows != cols) {
            fprintf(stderr, "Error: determinant requires a square matrix\n");
            free(mat);
            return;
        }
        printf("%g\n", compute_det(mat, (int)rows));
    } else {
        /* Transpose */
        for (size_t j = 0; j < cols; j++) {
            for (size_t i = 0; i < rows; i++) {
                printf("%g%s", mat[i * cols + j], (i + 1 < rows) ? " " : "\n");
            }
        }
    }

    free(mat);
}

int main(int argc, char **argv) {
    char *prog = strrchr(argv[0], '/');
    prog = prog ? prog + 1 : argv[0];

    if (strstr(prog, "fib")) {
        do_fib(argc, argv);
    } else if (strstr(prog, "gcd")) {
        do_gcd_lcm(0, argc, argv);
    } else if (strstr(prog, "lcm")) {
        do_gcd_lcm(1, argc, argv);
    } else if (strstr(prog, "stats")) {
        do_stats(argc, argv);
    } else if (strstr(prog, "matrix")) {
        do_matrix(argc, argv);
    } else {
        /* Default to stats */
        do_stats(argc, argv);
    }

    fflush(stdout);
    return 0;
}
