# Needed executables

1. **Encoding & Decoding**
   - `base32`: Base32 encoder and decoder
   - `urlencode`: URL encoder and decoder (`-d`)
   - `htmlencode`: HTML entity encoder and decoder (`-d`)
   - `atob` / `btoa`: Base64 conversion helpers
   - `rot13`: ROT13 substitution cipher
   - `caesar`: Caesar cipher with configurable shifts (`-n`)
   - `xxd-js`: Hex dumper and binary reverser (`-r`)

2. **Hashing & Checksums**
   - `sha512sum`: WebCrypto-backed SHA-512 calculation
   - `sha384sum`: WebCrypto-backed SHA-384 calculation
   - *(alongside built-in BusyBox `md5sum`, `sha1sum`, `sha256sum`, `cksum`, `crc32`)*

3. **Data & File Format Conversion (JSON / CSV / TSV / YAML / INI / ENV)**
   - `json-format`: JSON formatter and pretty-printer with custom indentation (`-i`) / compaction (`-c`)
   - `json-minify`: JSON minifier
   - `json-validate`: JSON validator and error locator
   - `json-keys`: Key and item count extractor
   - `json-flatten`: Flattens nested JSON structures into dot-notation paths
   - `sort-json`: Sorts JSON arrays by key or value (`-k`, `-r`)
   - `json2csv` & `csv2json`: Bidirectional CSV ↔ JSON converter
   - `json2tsv` & `tsv2json`: Bidirectional TSV ↔ JSON converter
   - `json2yaml`: JSON to YAML converter
   - `ini2json`: INI configuration to JSON converter
   - `env2json` & `json2env`: `.env` environment file ↔ JSON converter

4. **Text Manipulation, String Transformation & Generators**
   - `upper` & `lower`: Uppercase and lowercase conversion
   - `title-case` (`titlecase`): Title-casing
   - `camel-case` (`camelcase`): CamelCase converter
   - `snake-case` (`snakecase`): snake_case converter
   - `kebab-case` (`kebabcase`): kebab-case converter
   - `count-words`: Line, word, and character counter
   - `count-chars`: Character frequency table
   - `charfreq`: Visual character frequency histogram
   - `lorem`: Lorem ipsum placeholder text generator (`-n`)
   - `slugify`: Converts arbitrary text into URL-safe slugs
   - `str-reverse`: Reverses line contents
   - `str-repeat`: Repeats lines/text N times
   - `remove-dups`: Deduplicates lines in order
   - `random-line`: Randomly samples line(s) from input
   - `number-lines`: Numbers lines with aligned formatting
   - `wrap`: Word-wraps text to specified width (`-w`)
   - `banner-js`: ASCII art block banner generator
   - `morse`: Morse code encoder and decoder (`-d`)
   - `pig-latin`: Pig Latin converter
   - `anagram`: Checks whether words are anagrams
   - `palindrome`: Validates palindromes

5. **Numbers, Math & Advanced Computation**
   - `numbase`: Arbitrary base conversion between bases 2–36 (`-f`, `-t`)
   - `dec2bin`, `dec2hex`, `dec2oct`, `hex2dec`: Quick numeral conversions
   - `calc`: Math expression evaluator (supports operators, powers, and Math functions)
   - `rand`: Random integer generator with ranges (`MIN` `MAX`, `-n`)
   - `random-bytes`: Cryptographic random byte generator in hex
   - `is-prime`: Prime number verifier
   - `fib` (`fibonacci`): Generates Fibonacci sequences
   - `factor-js`: Prime factorizer
   - `gcd` & `lcm`: Greatest common divisor and least common multiple
   - `stats`: Full summary statistics (count, min, max, sum, mean, median, stddev)
   - `matrix`: Matrix operations (transpose, trace, determinant)

6. **UUIDs, Tokens & Security**
   - `uuidgen-js`: UUID v4 generator
   - `nanoid`: NanoID-style random token generator
   - `pwgen`: Configurable secure password generator (symbols, uppercase, digits)

7. **Color Conversion & Manipulation**
   - `hex2rgb`: Hex color `#RRGGBB` to `rgb(r, g, b)`
   - `rgb2hex`: RGB values to `#hex`
   - `color-mix`: Hex color interpolation with custom ratios

8. **Date, Time & Unit Conversion**
   - `timestamp`: Unix timestamp generator (seconds/ms) and date-string converter
   - `from-timestamp`: Timestamp to ISO 8601 string converter
   - `date-diff`: High-precision duration difference between dates
   - `cal-js`: Terminal monthly calendar generator
   - `bytes-human`: Human-readable byte formatting (e.g. `1024` → `1.00 KiB`) and reverse parsing
   - `temp`: Temperature conversion across Celsius, Fahrenheit, and Kelvin
   - `unit`: Measurement conversion across length, weight, and volume

9. **Network, Web & File Analysis**
   - `myip`: Public IP query
   - `nslookup-js`: DNS query via DNS-over-HTTPS (DoH)
   - `url-parse`: URL parser showing protocol, host, port, path, query parameters
   - `qr`: QR URL & text data previewer
   - `http-status`: HTTP status code dictionary
   - `mime-type`: MIME type lookup by extension
   - `entropy`: Shannon entropy calculator (detects encrypted/compressed data)
   - `detect-encoding`: Character encoding and BOM detector (UTF-8, UTF-16, ASCII)
   - `file-info`: File metadata summary
   - `wc-bytes`: Accurate byte length counter
   - `extract-urls`: Regex extractor for HTTP(S) URLs
   - `extract-emails`: Regex extractor for email addresses
   - `extract-ips`: Regex extractor for IPv4 addresses
   - `extract-numbers`: Regex extractor for numerical values

10. **Code Helpers, Regex & Markup**
    - `regex-test`: Filters matching lines by regular expression
    - `regex-replace`: Replaces pattern matches in text
    - `escape-string` & `unescape-string`: Escape / unescape for JSON, JavaScript, regex, and SQL
    - `line-endings`: Line-ending detector and converter (LF / CRLF / CR)
    - `indent`: Indentation style converter (tabs ↔ spaces)
    - `count-tokens`: Token estimator for LLMs (~4 chars/token)
    - `md2html`: Markdown to HTML converter
    - `html2text`: HTML stripper to plain readable text
    - `tools`: Integrated help directory listing all available tools

11. **Text & Character Encodings**
   - `dos2unix`, `unix2dos`, `mac2unix`: Line ending conversion (CRLF ↔ LF ↔ CR)
   - `iconv`: Multi-encoding converter (UTF-8, ISO-8859-1, Windows-1252, UTF-16, ASCII)
   - `recode`: Format and character set surface transformation

12. **Data Transformation & Query Suite**
   - `jq`: JSON query filter, slicing, projection, formatting (`-r`, `-c`)
   - `yq`: YAML / JSON / XML / Properties converter and query tool
   - `xq`: XML to JSON converter and jq query tool
   - `xmlstarlet`: XML format (`fo`) and value selection (`sel -t -v`)
   - `csvjson` / `in2csv`: CSV to JSON converter
   - `csvsql`: CSV to SQL table schema and insert script generator
   - `csvformat`: Custom CSV delimiter and tab formatter
   - `xlsx2csv`: Excel workbook XML sheet to CSV converter

13. **PDF, PostScript & Office Document Suite**
   - `pdftotext`: Plaintext extractor from PDF streams
   - `pdfinfo`: PDF metadata and page count inspector
   - `pdftk`: PDF merge (`cat`) and document builder
   - `qpdf`: PDF linearizer and transform engine
   - `gs` / `ghostscript`: PostScript & PDF rasterization / conversion
   - `img2pdf`: Direct image to PDF page generator
   - `pdfimages` & `pdftoppm`: PDF image and page rendering tools
   - `pandoc`: Universal markup converter (Markdown, HTML, LaTeX, plaintext)
   - `wkhtmltopdf` & `weasyprint`: HTML/CSS document to PDF converter
   - `enscript` & `a2ps`: Plaintext to PostScript formatter
   - `antiword`, `docx2txt`, `odt2txt`: Word (.doc/.docx) and OpenDocument (.odt) text extractors
   - `soffice` / `libreoffice`: Headless document converter
   - `ebook-convert`: EPUB/MOBI/HTML to document converter

14. **Image Suite**
   - `magick` / `convert`: ImageMagick conversion and processing engine
   - `gm`: GraphicsMagick CLI
   - `inkscape`: Vector SVG exporter and renderer
   - `rsvg-convert`: SVG to vector/raster output
   - `pngtopnm`, `jpegtopnm`, `pnmtojpeg`, `pnmtopng`: Netpbm suite
   - `cwebp` & `dwebp`: WebP encoder/decoder
   - `avifenc` & `avifdec`: AVIF encoder/decoder
   - `cjxl` & `djxl`: JPEG XL encoder/decoder
   - `potrace` & `autotrace`: Raster to vector SVG tracing
   - `optipng`, `jpegoptim`, `oxipng`: Lossless image optimizers

15. **Audio & Video Suite**
   - `ffmpeg`: Audio/video transcoding and stream processor
   - `sox`: Sound eXchange audio converter and generator
   - `HandBrakeCLI` / `handbrake`: Video transcoder
   - `flac`: Lossless audio encoder and decoder (`-d`)
   - `oggenc` & `oggdec`: Ogg Vorbis audio encoder/decoder
   - `opusenc` & `opusdec`: Low-latency Opus audio encoder/decoder
   - `lame`: MP3 audio encoder
   - `mkvmerge` & `mkvextract`: MKVToolNix Matroska multiplexer and demuxer

16. **Disk Images, Packaging & 3D CAD**
   - `qemu-img`: Virtual machine disk image converter (QCOW2, RAW, VMDK, VDI)
   - `bchunk`, `bin2iso`, `iat`: CD/DVD image converter to ISO 9660
   - `alien`: Linux package converter (.deb, .rpm, tarballs)
   - `7z` / `p7zip`: 7-Zip archiver
   - `assimp`: 3D model importer and exporter (OBJ, STL, PLY)
   - `meshlabserver`: 3D mesh batch processor
   - `openscad`: Solid 3D CAD CSG script compiler to STL/OBJ

17. **Linux Essentials**
   - `file`: Reads magic numbers and headers to reliably identify file types regardless of extensions.
   - `tree`: Recursively renders directory hierarchies with depth limiters (-L) and size summaries.
   - `binutils` (`strings`, `readelf`, `objdump`, `nm`): Extracts readable strings from compiled binaries, decodes ELF headers, and lists exported symbols from shared libraries.