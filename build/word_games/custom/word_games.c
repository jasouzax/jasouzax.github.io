/*
 * word_games - pig-latin, anagram, palindrome
 * MIT License
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <ctype.h>

static int is_vowel(char c) {
    c = tolower((unsigned char)c);
    return (c == 'a' || c == 'e' || c == 'i' || c == 'o' || c == 'u');
}

static void pig_latin_word(const char *word) {
    if (word[0] == '\0') return;
    if (is_vowel(word[0])) {
        printf("%sway", word);
    } else {
        int split = 0;
        while (word[split] && !is_vowel(word[split])) split++;
        if (word[split] == '\0') {
            printf("%say", word);
        } else {
            printf("%s", word + split);
            for (int i = 0; i < split; i++) putchar(word[i]);
            printf("ay");
        }
    }
}

static void do_pig_latin(int argc, char **argv) {
    if (argc > 1) {
        for (int i = 1; i < argc; i++) {
            pig_latin_word(argv[i]);
            if (i + 1 < argc) putchar(' ');
        }
        putchar('\n');
    } else {
        char buf[256];
        int first = 1;
        while (scanf("%255s", buf) == 1) {
            if (!first) putchar(' ');
            pig_latin_word(buf);
            first = 0;
        }
        putchar('\n');
    }
}

static int is_palindrome(const char *s) {
    int i = 0, j = strlen(s) - 1;
    while (i < j) {
        while (i < j && !isalnum((unsigned char)s[i])) i++;
        while (i < j && !isalnum((unsigned char)s[j])) j--;
        if (tolower((unsigned char)s[i]) != tolower((unsigned char)s[j])) return 0;
        i++;
        j--;
    }
    return 1;
}

static int are_anagrams(const char *w1, const char *w2) {
    int c1[26] = {0}, c2[26] = {0};
    for (; *w1; w1++) if (isalpha((unsigned char)*w1)) c1[tolower((unsigned char)*w1) - 'a']++;
    for (; *w2; w2++) if (isalpha((unsigned char)*w2)) c2[tolower((unsigned char)*w2) - 'a']++;
    for (int i = 0; i < 26; i++) if (c1[i] != c2[i]) return 0;
    return 1;
}

int main(int argc, char **argv) {
    char *prog = strrchr(argv[0], '/');
    prog = prog ? prog + 1 : argv[0];

    if (strstr(prog, "pig")) {
        do_pig_latin(argc, argv);
    } else if (strstr(prog, "palindrome")) {
        char buf[1024] = {0};
        if (argc > 1) {
            for (int i = 1; i < argc; i++) {
                strcat(buf, argv[i]);
                if (i + 1 < argc) strcat(buf, " ");
            }
        } else {
            if (fgets(buf, sizeof(buf), stdin)) {
                buf[strcspn(buf, "\r\n")] = '\0';
            }
        }
        int res = is_palindrome(buf);
        printf("%s\n", res ? "true" : "false");
        return res ? 0 : 1;
    } else {
        /* anagram */
        if (argc < 3) {
            fprintf(stderr, "Usage: anagram <word1> <word2>\n");
            return 1;
        }
        int res = are_anagrams(argv[1], argv[2]);
        printf("%s\n", res ? "true" : "false");
        return res ? 0 : 1;
    }
    fflush(stdout);
    return 0;
}
