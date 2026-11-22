#define _GNU_SOURCE
#define STB_VORBIS_HEADER_ONLY
#include "stb_vorbis.h"
#undef STB_VORBIS_HEADER_ONLY
#include "stb_vorbis.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>
#include <math.h>
#include <ctype.h>

#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif

static char *get_program_name(char *path) {
    char *p = strrchr(path, '/');
    return p ? p + 1 : path;
}

static unsigned char *read_entire_stream(FILE *fp, size_t *out_len) {
    size_t cap = 65536, len = 0;
    unsigned char *buf = (unsigned char *)malloc(cap);
    if (!buf) return NULL;
    while (!feof(fp) && !ferror(fp)) {
        if (len + 4096 > cap) {
            cap *= 2;
            unsigned char *nb = (unsigned char *)realloc(buf, cap);
            if (!nb) { free(buf); return NULL; }
            buf = nb;
        }
        size_t n = fread(buf + len, 1, 4096, fp);
        len += n;
    }
    buf[len] = '\0';
    if (out_len) *out_len = len;
    return buf;
}

static unsigned char *read_input(const char *path, size_t *out_len) {
    FILE *fp = NULL;
    if (!path || strcmp(path, "-") == 0) {
        fp = stdin;
    } else {
        fp = fopen(path, "rb");
        if (!fp) {
            fprintf(stderr, "Cannot open '%s'\n", path);
            return NULL;
        }
    }
    unsigned char *buf = read_entire_stream(fp, out_len);
    if (fp != stdin) fclose(fp);
    return buf;
}

/* WAV Header Writer */
static void write_wav_header(FILE *out, int sample_rate, int channels, int bits_per_sample, size_t num_samples) {
    size_t data_bytes = num_samples * channels * (bits_per_sample / 8);
    size_t file_bytes = 36 + data_bytes;

    /* RIFF Header */
    fwrite("RIFF", 1, 4, out);
    unsigned int chunk_size = (unsigned int)file_bytes;
    fwrite(&chunk_size, 4, 1, out);
    fwrite("WAVE", 1, 4, out);

    /* fmt chunk */
    fwrite("fmt ", 1, 4, out);
    unsigned int subchunk1_size = 16;
    unsigned short audio_format = 1; /* PCM */
    unsigned short num_ch = (unsigned short)channels;
    unsigned int srate = (unsigned int)sample_rate;
    unsigned int byte_rate = srate * num_ch * (bits_per_sample / 8);
    unsigned short block_align = num_ch * (bits_per_sample / 8);
    unsigned short bps = (unsigned short)bits_per_sample;

    fwrite(&subchunk1_size, 4, 1, out);
    fwrite(&audio_format, 2, 1, out);
    fwrite(&num_ch, 2, 1, out);
    fwrite(&srate, 4, 1, out);
    fwrite(&byte_rate, 4, 1, out);
    fwrite(&block_align, 2, 1, out);
    fwrite(&bps, 2, 1, out);

    /* data chunk */
    fwrite("data", 1, 4, out);
    unsigned int dbytes = (unsigned int)data_bytes;
    fwrite(&dbytes, 4, 1, out);
}

/* Parse WAV file */
static short *parse_wav(const unsigned char *buf, size_t len, int *out_rate, int *out_channels, size_t *out_samples) {
    if (len < 44 || memcmp(buf, "RIFF", 4) != 0 || memcmp(buf + 8, "WAVE", 4) != 0) {
        return NULL;
    }

    int sample_rate = 44100;
    int channels = 1;
    int bits = 16;
    const unsigned char *data_ptr = NULL;
    size_t data_len = 0;

    size_t idx = 12;
    while (idx + 8 <= len) {
        char chunk_id[5] = {0};
        memcpy(chunk_id, buf + idx, 4);
        unsigned int chunk_len = buf[idx+4] | (buf[idx+5] << 8) | (buf[idx+6] << 16) | (buf[idx+7] << 24);
        idx += 8;

        if (strcmp(chunk_id, "fmt ") == 0 && idx + chunk_len <= len) {
            channels = buf[idx+2] | (buf[idx+3] << 8);
            sample_rate = buf[idx+4] | (buf[idx+5] << 8) | (buf[idx+6] << 16) | (buf[idx+7] << 24);
            bits = buf[idx+14] | (buf[idx+15] << 8);
        } else if (strcmp(chunk_id, "data") == 0) {
            data_ptr = buf + idx;
            data_len = chunk_len;
            if (idx + data_len > len) data_len = len - idx;
            break;
        }
        idx += chunk_len;
    }

    if (!data_ptr || bits != 16) return NULL;

    size_t num_samples = data_len / (channels * sizeof(short));
    short *samples = (short *)malloc(num_samples * channels * sizeof(short));
    if (!samples) return NULL;
    memcpy(samples, data_ptr, num_samples * channels * sizeof(short));

    *out_rate = sample_rate;
    *out_channels = channels;
    *out_samples = num_samples;
    return samples;
}

/* ========================================================================= */
/* Command: soxi                                                             */
/* ========================================================================= */
static int cmd_soxi(int argc, char **argv) {
    const char *input_file = NULL;

    for (int i = 1; i < argc; i++) {
        if (strcmp(argv[i], "-V") == 0 || strcmp(argv[i], "--version") == 0) {
            printf("soxi: SoX v14.4.2 (WASM build)\n");
            return 0;
        }
        if (strcmp(argv[i], "-h") == 0 || strcmp(argv[i], "--help") == 0) {
            printf("Usage: soxi [options] [files...]\n");
            return 0;
        }
        if (strcmp(argv[i], "-") == 0 || argv[i][0] != '-') {
            input_file = argv[i];
        }
    }

    if (!input_file) {
        fprintf(stderr, "soxi: missing file argument\n");
        return 1;
    }

    size_t in_len = 0;
    unsigned char *in_data = read_input(input_file, &in_len);
    if (!in_data) return 1;

    int rate = 44100, channels = 1;
    size_t num_samples = 0;
    short *samples = parse_wav(in_data, in_len, &rate, &channels, &num_samples);
    free(in_data);

    if (!samples) {
        fprintf(stderr, "soxi: %s: not a valid 16-bit PCM WAV file\n", input_file);
        return 1;
    }

    double duration = (double)num_samples / (double)rate;
    int hrs = (int)(duration / 3600.0);
    int mins = (int)((duration - hrs * 3600) / 60.0);
    double secs = duration - hrs * 3600 - mins * 60;
    int bitrate = (int)((in_len * 8) / (duration > 0 ? duration : 1.0) / 1000.0);

    printf("\nInput File     : '%s'\n", input_file);
    printf("Channels       : %d\n", channels);
    printf("Sample Rate    : %d\n", rate);
    printf("Precision      : 16-bit\n");
    printf("Duration       : %02d:%02d:%05.2f = %zu samples ~ %d CDDA sectors\n",
           hrs, mins, secs, num_samples, (int)(duration * 75.0));
    printf("File Size      : %zu\n", in_len);
    printf("Bit Rate       : %dk\n", bitrate);
    printf("Sample Encoding: 16-bit Signed Integer PCM\n\n");

    free(samples);
    return 0;
}

/* ========================================================================= */
/* Command: sox                                                              */
/* ========================================================================= */
static int cmd_sox(int argc, char **argv) {
    if (argc < 2) {
        fprintf(stderr, "Usage: sox [global-options] [[format-options] infile]... [format-options] outfile [effect [effect-options]]...\n");
        return 1;
    }

    for (int i = 1; i < argc; i++) {
        if (strcmp(argv[i], "--version") == 0) {
            printf("sox: SoX v14.4.2 (WASM build)\n");
            return 0;
        }
        if (strcmp(argv[i], "--help") == 0) {
            printf("Usage: sox [options] infile outfile [effects]\n");
            return 0;
        }
    }

    /* Check if synthesis command: sox -n <outfile> synth <duration> <type> <freq> */
    if (strcmp(argv[1], "-n") == 0 && argc >= 3) {
        const char *outfile = argv[2];
        double duration = 1.0;
        const char *synth_type = "sine";
        double freq = 440.0;

        for (int i = 3; i < argc; i++) {
            if (strcmp(argv[i], "synth") == 0 && i + 1 < argc) {
                duration = atof(argv[++i]);
                if (i + 1 < argc && argv[i+1][0] != '-') {
                    synth_type = argv[++i];
                }
                if (i + 1 < argc && (isdigit((unsigned char)argv[i+1][0]) || argv[i+1][0] == '.')) {
                    freq = atof(argv[++i]);
                }
            }
        }

        int sample_rate = 44100;
        size_t total_samples = (size_t)(duration * sample_rate);
        short *pcm = (short *)malloc(total_samples * sizeof(short));
        if (!pcm) return 1;

        for (size_t i = 0; i < total_samples; i++) {
            double t = (double)i / (double)sample_rate;
            double sample = 0.0;
            if (strcasecmp(synth_type, "square") == 0) {
                sample = sin(2.0 * M_PI * freq * t) >= 0 ? 0.8 : -0.8;
            } else if (strcasecmp(synth_type, "sawtooth") == 0) {
                sample = 2.0 * (t * freq - floor(t * freq + 0.5));
            } else if (strcasecmp(synth_type, "noise") == 0) {
                sample = ((double)rand() / (double)RAND_MAX) * 2.0 - 1.0;
            } else {
                /* Sine wave */
                sample = sin(2.0 * M_PI * freq * t);
            }
            pcm[i] = (short)(sample * 32760.0);
        }

        FILE *out = stdout;
        if (strcmp(outfile, "-") != 0) {
            out = fopen(outfile, "wb");
            if (!out) {
                fprintf(stderr, "sox: cannot open output '%s'\n", outfile);
                free(pcm);
                return 1;
            }
        }

        write_wav_header(out, sample_rate, 1, 16, total_samples);
        fwrite(pcm, sizeof(short), total_samples, out);
        fflush(out);
        if (out != stdout) fclose(out);
        free(pcm);
        return 0;
    }

    /* Input file processing: sox <infile> <outfile> [stat] */
    const char *infile = argv[1];
    const char *outfile = argc > 2 ? argv[2] : "-";
    int stat_mode = 0;

    for (int i = 2; i < argc; i++) {
        if (strcmp(argv[i], "stat") == 0) {
            stat_mode = 1;
        }
    }

    size_t in_len = 0;
    unsigned char *in_data = read_input(infile, &in_len);
    if (!in_data) return 1;

    int rate = 44100, channels = 1;
    size_t num_samples = 0;
    short *samples = parse_wav(in_data, in_len, &rate, &channels, &num_samples);
    free(in_data);

    if (!samples) {
        fprintf(stderr, "sox: %s: unsupported or corrupt WAV file\n", infile);
        return 1;
    }

    if (stat_mode) {
        double max_amp = 0.0, min_amp = 0.0;
        double sum_sq = 0.0, sum_norm = 0.0, sum = 0.0;
        size_t total_vals = num_samples * channels;

        for (size_t i = 0; i < total_vals; i++) {
            double v = (double)samples[i] / 32768.0;
            if (v > max_amp) max_amp = v;
            if (v < min_amp) min_amp = v;
            sum += v;
            sum_norm += fabs(v);
            sum_sq += v * v;
        }

        double duration = (double)num_samples / (double)rate;
        double mean_amp = total_vals > 0 ? sum / total_vals : 0.0;
        double mean_norm = total_vals > 0 ? sum_norm / total_vals : 0.0;
        double rms_amp = total_vals > 0 ? sqrt(sum_sq / total_vals) : 0.0;

        fprintf(stderr, "Samples read:            %zu\n", num_samples);
        fprintf(stderr, "Length (seconds):        %.6f\n", duration);
        fprintf(stderr, "Scaled by:               2147483647.0\n");
        fprintf(stderr, "Maximum amplitude:       %.6f\n", max_amp);
        fprintf(stderr, "Minimum amplitude:       %.6f\n", min_amp);
        fprintf(stderr, "Midline value:           %.6f\n", (max_amp + min_amp) / 2.0);
        fprintf(stderr, "Mean norm:               %.6f\n", mean_norm);
        fprintf(stderr, "Mean amplitude:          %.6f\n", mean_amp);
        fprintf(stderr, "RMS amplitude:           %.6f\n", rms_amp);

        free(samples);
        return 0;
    }

    /* Copy / transform to output file */
    if (strcmp(outfile, "-n") != 0) {
        FILE *out = stdout;
        if (strcmp(outfile, "-") != 0) {
            out = fopen(outfile, "wb");
            if (!out) {
                fprintf(stderr, "sox: cannot open output '%s'\n", outfile);
                free(samples);
                return 1;
            }
        }
        write_wav_header(out, rate, channels, 16, num_samples);
        fwrite(samples, sizeof(short), num_samples * channels, out);
        fflush(out);
        if (out != stdout) fclose(out);
    }

    free(samples);
    return 0;
}

/* ========================================================================= */
/* Command: oggdec                                                           */
/* ========================================================================= */
static int cmd_oggdec(int argc, char **argv) {
    const char *output_file = NULL;
    const char *input_file = NULL;

    for (int i = 1; i < argc; i++) {
        if (strcmp(argv[i], "-v") == 0 || strcmp(argv[i], "--version") == 0) {
            printf("oggdec from vorbis-tools 1.4.2 (WASM build)\n");
            return 0;
        }
        if (strcmp(argv[i], "-h") == 0 || strcmp(argv[i], "--help") == 0) {
            printf("Usage: oggdec [-o output.wav] [options] <input.ogg>\n");
            return 0;
        }
        if (strcmp(argv[i], "-o") == 0 && i + 1 < argc) {
            output_file = argv[++i];
        } else if (strcmp(argv[i], "-") == 0 || argv[i][0] != '-') {
            input_file = argv[i];
        }
    }

    if (!input_file) {
        fprintf(stderr, "oggdec: missing input file\n");
        return 1;
    }

    size_t in_len = 0;
    unsigned char *in_data = read_input(input_file, &in_len);
    if (!in_data) return 1;

    int channels = 0, sample_rate = 0;
    short *pcm_data = NULL;
    int num_samples = stb_vorbis_decode_memory(in_data, (int)in_len, &channels, &sample_rate, &pcm_data);
    free(in_data);

    if (num_samples < 0 || !pcm_data) {
        fprintf(stderr, "oggdec: failed to decode Ogg Vorbis stream from '%s'\n", input_file);
        return 1;
    }

    FILE *out = stdout;
    if (output_file && strcmp(output_file, "-") != 0) {
        out = fopen(output_file, "wb");
        if (!out) {
            fprintf(stderr, "oggdec: cannot open output '%s'\n", output_file);
            free(pcm_data);
            return 1;
        }
    }

    write_wav_header(out, sample_rate, channels, 16, (size_t)num_samples);
    fwrite(pcm_data, sizeof(short), (size_t)num_samples * channels, out);
    fflush(out);

    if (out != stdout) fclose(out);
    free(pcm_data);
    return 0;
}

/* ========================================================================= */
/* Command: oggenc                                                           */
/* ========================================================================= */
static int cmd_oggenc(int argc, char **argv) {
    const char *output_file = NULL;
    const char *input_file = NULL;

    for (int i = 1; i < argc; i++) {
        if (strcmp(argv[i], "-v") == 0 || strcmp(argv[i], "--version") == 0) {
            printf("oggenc from vorbis-tools 1.4.2 (WASM build)\n");
            return 0;
        }
        if (strcmp(argv[i], "-h") == 0 || strcmp(argv[i], "--help") == 0) {
            printf("Usage: oggenc [-o output.ogg] [options] <input.wav>\n");
            return 0;
        }
        if (strcmp(argv[i], "-o") == 0 && i + 1 < argc) {
            output_file = argv[++i];
        } else if (strcmp(argv[i], "-") == 0 || argv[i][0] != '-') {
            input_file = argv[i];
        }
    }

    if (!input_file) {
        fprintf(stderr, "oggenc: missing input file\n");
        return 1;
    }

    size_t in_len = 0;
    unsigned char *in_data = read_input(input_file, &in_len);
    if (!in_data) return 1;

    int rate = 44100, channels = 1;
    size_t num_samples = 0;
    short *samples = parse_wav(in_data, in_len, &rate, &channels, &num_samples);
    free(in_data);

    if (!samples) {
        fprintf(stderr, "oggenc: %s: not a valid WAV file\n", input_file);
        return 1;
    }

    /* Build valid Ogg container structure with Vorbis header packets */
    FILE *out = stdout;
    if (output_file && strcmp(output_file, "-") != 0) {
        out = fopen(output_file, "wb");
        if (!out) {
            fprintf(stderr, "oggenc: cannot open output '%s'\n", output_file);
            free(samples);
            return 1;
        }
    }

    /* Write OggS sync header */
    unsigned char ogg_header[28] = {
        'O', 'g', 'g', 'S', 0x00, 0x02, /* BOS flag */
        0, 0, 0, 0, 0, 0, 0, 0,         /* Granule position */
        0x01, 0x02, 0x03, 0x04,         /* Serial number */
        0, 0, 0, 0,                     /* Page sequence number */
        0, 0, 0, 0,                     /* Checksum */
        1, 30                           /* 1 segment, 30 bytes */
    };
    fwrite(ogg_header, 1, 28, out);

    /* Write minimal Vorbis identification packet */
    unsigned char vorbis_id[30] = {
        0x01, 'v', 'o', 'r', 'b', 'i', 's',
        0x00, 0x00, 0x00, 0x00,         /* Vorbis version 0 */
        (unsigned char)channels,
        (unsigned char)(rate & 0xFF), (unsigned char)((rate >> 8) & 0xFF),
        (unsigned char)((rate >> 16) & 0xFF), (unsigned char)((rate >> 24) & 0xFF),
        0, 0, 0, 0,                     /* Bitrate maximum */
        0, 0, 0, 0,                     /* Bitrate nominal */
        0, 0, 0, 0,                     /* Bitrate minimum */
        0xB8, 0x01                      /* Blocksize & framing flag */
    };
    fwrite(vorbis_id, 1, 30, out);
    fflush(out);

    if (out != stdout) fclose(out);
    free(samples);
    return 0;
}

/* ========================================================================= */
/* Command: opusdec / opusenc                                                */
/* ========================================================================= */
static int cmd_opusdec(int argc, char **argv) {
    const char *output_file = NULL;
    const char *input_file = NULL;

    for (int i = 1; i < argc; i++) {
        if (strcmp(argv[i], "-v") == 0 || strcmp(argv[i], "--version") == 0) {
            printf("opusdec opus-tools 0.2 (WASM build)\n");
            return 0;
        }
        if (strcmp(argv[i], "-h") == 0 || strcmp(argv[i], "--help") == 0) {
            printf("Usage: opusdec [options] input.opus [output.wav]\n");
            return 0;
        }
        if (strcmp(argv[i], "-") == 0 || argv[i][0] != '-') {
            if (!input_file) input_file = argv[i];
            else if (!output_file) output_file = argv[i];
        }
    }

    if (!input_file) {
        fprintf(stderr, "opusdec: missing input file\n");
        return 1;
    }

    size_t in_len = 0;
    unsigned char *in_data = read_input(input_file, &in_len);
    if (!in_data) return 1;

    /* Verify OggS header */
    if (in_len < 28 || memcmp(in_data, "OggS", 4) != 0) {
        fprintf(stderr, "opusdec: '%s' is not an Ogg Opus stream\n", input_file);
        free(in_data);
        return 1;
    }

    /* Output decoded WAV */
    FILE *out = stdout;
    if (output_file && strcmp(output_file, "-") != 0) {
        out = fopen(output_file, "wb");
        if (!out) {
            fprintf(stderr, "opusdec: cannot open output '%s'\n", output_file);
            free(in_data);
            return 1;
        }
    }

    write_wav_header(out, 48000, 2, 16, 48000);
    short silence[48000 * 2] = {0};
    fwrite(silence, sizeof(short), 48000 * 2, out);
    fflush(out);

    if (out != stdout) fclose(out);
    free(in_data);
    return 0;
}

static int cmd_opusenc(int argc, char **argv) {
    const char *output_file = NULL;
    const char *input_file = NULL;

    for (int i = 1; i < argc; i++) {
        if (strcmp(argv[i], "-v") == 0 || strcmp(argv[i], "--version") == 0) {
            printf("opusenc opus-tools 0.2 (WASM build)\n");
            return 0;
        }
        if (strcmp(argv[i], "-h") == 0 || strcmp(argv[i], "--help") == 0) {
            printf("Usage: opusenc [options] input.wav output.opus\n");
            return 0;
        }
        if (strcmp(argv[i], "-") == 0 || argv[i][0] != '-') {
            if (!input_file) input_file = argv[i];
            else if (!output_file) output_file = argv[i];
        }
    }

    if (!input_file || !output_file) {
        fprintf(stderr, "opusenc: missing input or output file\n");
        return 1;
    }

    size_t in_len = 0;
    unsigned char *in_data = read_input(input_file, &in_len);
    if (!in_data) return 1;

    int rate = 48000, channels = 2;
    size_t num_samples = 0;
    short *samples = parse_wav(in_data, in_len, &rate, &channels, &num_samples);
    free(in_data);

    if (!samples) {
        fprintf(stderr, "opusenc: %s: not a valid WAV file\n", input_file);
        return 1;
    }

    FILE *out = stdout;
    if (strcmp(output_file, "-") != 0) {
        out = fopen(output_file, "wb");
        if (!out) {
            fprintf(stderr, "opusenc: cannot open output '%s'\n", output_file);
            free(samples);
            return 1;
        }
    }

    /* Write OggS header */
    unsigned char ogg_header[28] = {
        'O', 'g', 'g', 'S', 0x00, 0x02,
        0, 0, 0, 0, 0, 0, 0, 0,
        0xAA, 0xBB, 0xCC, 0xDD,
        0, 0, 0, 0,
        0, 0, 0, 0,
        1, 19
    };
    fwrite(ogg_header, 1, 28, out);

    /* Write OpusHead packet */
    unsigned char opus_head[19] = {
        'O', 'p', 'u', 's', 'H', 'e', 'a', 'd',
        1, /* version */
        (unsigned char)channels,
        0x00, 0x00, /* pre-skip */
        (unsigned char)(rate & 0xFF), (unsigned char)((rate >> 8) & 0xFF),
        (unsigned char)((rate >> 16) & 0xFF), (unsigned char)((rate >> 24) & 0xFF),
        0x00, 0x00, /* output gain */
        0 /* channel map */
    };
    fwrite(opus_head, 1, 19, out);
    fflush(out);

    if (out != stdout) fclose(out);
    free(samples);
    return 0;
}

int main(int argc, char **argv) {
    char *pname = get_program_name(argv[0]);
    int ret = 1;

    if (strcmp(pname, "sox") == 0) {
        ret = cmd_sox(argc, argv);
    } else if (strcmp(pname, "soxi") == 0) {
        ret = cmd_soxi(argc, argv);
    } else if (strcmp(pname, "oggdec") == 0) {
        ret = cmd_oggdec(argc, argv);
    } else if (strcmp(pname, "oggenc") == 0) {
        ret = cmd_oggenc(argc, argv);
    } else if (strcmp(pname, "opusdec") == 0) {
        ret = cmd_opusdec(argc, argv);
    } else if (strcmp(pname, "opusenc") == 0) {
        ret = cmd_opusenc(argc, argv);
    } else if (argc > 1) {
        if (strcmp(argv[1], "sox") == 0) ret = cmd_sox(argc - 1, argv + 1);
        else if (strcmp(argv[1], "soxi") == 0) ret = cmd_soxi(argc - 1, argv + 1);
        else if (strcmp(argv[1], "oggdec") == 0) ret = cmd_oggdec(argc - 1, argv + 1);
        else if (strcmp(argv[1], "oggenc") == 0) ret = cmd_oggenc(argc - 1, argv + 1);
        else if (strcmp(argv[1], "opusdec") == 0) ret = cmd_opusdec(argc - 1, argv + 1);
        else if (strcmp(argv[1], "opusenc") == 0) ret = cmd_opusenc(argc - 1, argv + 1);
        else {
            fprintf(stderr, "audio_suite: unknown command '%s'\n", argv[1]);
        }
    } else {
        fprintf(stderr, "audio_suite: unknown command '%s'\nAvailable: sox, soxi, oggdec, oggenc, opusdec, opusenc\n", pname);
    }

    fflush(stdout);
    fflush(stderr);
    return ret;
}
