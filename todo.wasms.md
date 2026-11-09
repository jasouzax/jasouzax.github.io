# Needed executables

1. **Encoding & Decoding**
   - [x] `base32`: Base32 encoder and decoder (provided by BusyBox WASM)
   - [x] `urlencode`: URL encoder and decoder (`-d`) (urlencode.wasm)
   - [x] `htmlencode`: HTML entity encoder and decoder (`-d`) (htmlencode.wasm)
   - [x] `atob` / `btoa`: Base64 conversion helpers (atob.wasm / btoa.wasm)
   - [x] `rot13`: ROT13 substitution cipher (rot13.wasm)
   - [x] `caesar`: Caesar cipher with configurable shifts (`-n`) (FreeBSD caesar.wasm)
   - [x] `xxd-js` / `xxd`: Hex dumper and binary reverser (`-r`) (provided by BusyBox WASM)

2. **Hashing & Checksums**
   - [x] `sha512sum`: SHA-512 calculation (provided by BusyBox WASM)
   - [x] `sha384sum`: SHA-384 calculation (RFC 6234 sha384sum.wasm)
   - [x] `md5sum`, `sha1sum`, `sha256sum`, `cksum`, `crc32` (provided by BusyBox WASM)

3. **Data & File Format Conversion (JSON / CSV / TSV / YAML / INI / ENV)**
   - [x] `json-format`: JSON formatter and pretty-printer (provided by jq WASM)
   - [x] `json-minify`: JSON minifier (provided by jq WASM)
   - [x] `json-validate`: JSON validator and error locator (provided by jq WASM)
   - [x] `json-keys`: Key and item count extractor (provided by jq WASM)
   - [x] `json-flatten`: Flattens nested JSON structures into dot-notation paths (json_flatten.wasm)
   - [x] `sort-json`: Sorts JSON arrays by key or value (provided by jq WASM)
   - [x] `json2csv` & `csv2json`: Bidirectional CSV ↔ JSON converter (csv_json.wasm)
   - [x] `json2tsv` & `tsv2json`: Bidirectional TSV ↔ JSON converter (csv_json.wasm)
   - [x] `json2yaml`: JSON to YAML converter (json2yaml.wasm)
   - [x] `ini2json`: INI configuration to JSON converter (ini_env_json.wasm)
   - [x] `env2json` & `json2env`: `.env` environment file ↔ JSON converter (ini_env_json.wasm)

4. **Text Manipulation, String Transformation & Generators**
   - [x] `upper` & `lower`: Uppercase and lowercase conversion (provided by BusyBox `tr` WASM)
   - [x] `title-case` (`titlecase`): Title-casing (`casing_tools.wasm`)
   - [x] `camel-case` (`camelcase`): CamelCase converter (`casing_tools.wasm`)
   - [x] `snake-case` (`snakecase`): snake_case converter (`casing_tools.wasm`)
   - [x] `kebab-case` (`kebabcase`): kebab-case converter (`casing_tools.wasm`)
   - [x] `count-words`: Line, word, and character counter (provided by BusyBox `wc` WASM)
   - [x] `count-chars`: Character frequency table (`text_stats.wasm`)
   - [x] `charfreq`: Visual character frequency histogram (`text_stats.wasm`)
   - [x] `lorem`: Lorem ipsum placeholder text generator (`text_gen.wasm`)
   - [x] `slugify`: Converts arbitrary text into URL-safe slugs (`casing_tools.wasm`)
   - [x] `str-reverse`: Reverses line contents (provided by BusyBox `rev` WASM)
   - [x] `str-repeat`: Repeats lines/text N times (`text_gen.wasm`)
   - [x] `remove-dups`: Deduplicates lines in order (provided by BusyBox `uniq` / `sort` WASM)
   - [x] `random-line`: Randomly samples line(s) from input (provided by BusyBox `shuf` WASM)
   - [x] `number-lines`: Numbers lines with aligned formatting (provided by BusyBox `nl` WASM)
   - [x] `wrap`: Word-wraps text to specified width (`-w`) (provided by BusyBox `fold` WASM)
   - [x] `banner-js`: ASCII art block banner generator (`banner.wasm`)
   - [x] `morse`: Morse code encoder and decoder (FreeBSD morse.wasm)
   - [x] `pig-latin`: Pig Latin converter (`word_games.wasm`)
   - [x] `anagram`: Checks whether words are anagrams (`word_games.wasm`)
   - [x] `palindrome`: Validates palindromes (`word_games.wasm`)

5. **Numbers, Math & Advanced Computation**
   - [x] `numbase`: Arbitrary base conversion between bases 2–36 (`-f`, `-t`) (`numbase.wasm`)
   - [x] `dec2bin`, `dec2hex`, `dec2oct`, `hex2dec`: Quick numeral conversions (`numbase.wasm`)
   - [x] `calc`: Math expression evaluator (provided by BusyBox `bc` / `dc` WASM)
   - [x] `rand`: Random integer generator with ranges (provided by BusyBox `shuf` WASM)
   - [x] `random-bytes`: Cryptographic random byte generator in hex (`random_bytes.wasm`)
   - [x] `is-prime` / `factor-js`: Prime factorizer and primality tester (provided by BusyBox `factor` WASM)
   - [x] `fib` (`fibonacci`): Generates Fibonacci sequences (`math_suite.wasm`)
   - [x] `gcd` & `lcm`: Greatest common divisor and least common multiple (`math_suite.wasm`)
   - [x] `stats`: Full summary statistics (count, min, max, sum, mean, median, stddev) (`math_suite.wasm`)
   - [x] `matrix`: Matrix operations (transpose, trace, determinant) (`math_suite.wasm`)

6. **UUIDs, Tokens & Security**
   - [ ] `uuidgen-js`: UUID v4 generator
   - [ ] `nanoid`: NanoID-style random token generator
   - [x] `pwgen`: Configurable secure password generator (Theodore Ts'o pwgen.wasm)

7. **Color Conversion & Manipulation**
   - [ ] `hex2rgb`: Hex color `#RRGGBB` to `rgb(r, g, b)`
   - [ ] `rgb2hex`: RGB values to `#hex`
   - [ ] `color-mix`: Hex color interpolation with custom ratios

8. **Date, Time & Unit Conversion**
   - [x] `timestamp`: Unix timestamp generator and date-string converter (provided by BusyBox `date` WASM)
   - [x] `from-timestamp`: Timestamp to ISO 8601 string converter (provided by BusyBox `date` WASM)
   - [ ] `date-diff`: High-precision duration difference between dates
   - [x] `cal-js`: Terminal monthly calendar generator (provided by BusyBox `cal` WASM)
   - [ ] `bytes-human`: Human-readable byte formatting and reverse parsing
   - [ ] `temp`: Temperature conversion across Celsius, Fahrenheit, and Kelvin
   - [ ] `unit`: Measurement conversion across length, weight, and volume

9. **Network, Web & File Analysis**
   - ~~`myip`: Public IP query~~ *(Cannot be done: Browser WASM environment blocks raw socket / external network access)*
   - ~~`nslookup-js`: DNS query via DoH~~ *(Cannot be done: Browser WASM sandbox restricts arbitrary UDP/DNS sockets)*
   - [ ] `url-parse`: URL parser showing protocol, host, port, path, query parameters
   - [ ] `qr`: QR URL & text data previewer
   - [ ] `http-status`: HTTP status code dictionary
   - [ ] `mime-type`: MIME type lookup by extension
   - [ ] `entropy`: Shannon entropy calculator (detects encrypted/compressed data)
   - [ ] `detect-encoding`: Character encoding and BOM detector (UTF-8, UTF-16, ASCII)
   - [ ] `file-info`: File metadata summary
   - [x] `wc-bytes`: Accurate byte length counter (provided by BusyBox `wc -c` WASM)
   - [x] `extract-urls`: Regex extractor for HTTP(S) URLs (provided by BusyBox `grep -oE` WASM)
   - [x] `extract-emails`: Regex extractor for email addresses (provided by BusyBox `grep -oE` WASM)
   - [x] `extract-ips`: Regex extractor for IPv4 addresses (provided by BusyBox `grep -oE` WASM)
   - [x] `extract-numbers`: Regex extractor for numerical values (provided by BusyBox `grep -oE` WASM)

10. **Code Helpers, Regex & Markup**
    - [x] `regex-test`: Filters matching lines by regular expression (provided by BusyBox `grep -E` WASM)
    - [x] `regex-replace`: Replaces pattern matches in text (provided by BusyBox `sed -E` WASM)
    - [ ] `escape-string` & `unescape-string`: Escape / unescape for JSON, JavaScript, regex, and SQL
    - [x] `line-endings`: Line-ending detector and converter (provided by BusyBox `dos2unix` / `unix2dos` WASM)
    - [x] `indent`: Indentation style converter (provided by BusyBox `expand` / `unexpand` WASM)
    - [ ] `count-tokens`: Token estimator for LLMs (~4 chars/token)
    - [ ] `md2html`: Markdown to HTML converter
    - [ ] `html2text`: HTML stripper to plain readable text
    - [ ] `tools`: Integrated help directory listing all available tools

11. **Text & Character Encodings**
    - [x] `dos2unix`, `unix2dos`, `mac2unix`: Line ending conversion (provided by BusyBox WASM)
    - [ ] `iconv`: Multi-encoding converter (UTF-8, ISO-8859-1, Windows-1252, UTF-16, ASCII)
    - [ ] `recode`: Format and character set surface transformation

12. **Data Transformation & Query Suite**
    - [x] `jq`: JSON query filter, slicing, projection, formatting (`-r`, `-c`) (jq.wasm)
    - [ ] `yq`: YAML / JSON / XML / Properties converter and query tool
    - [ ] `xq`: XML to JSON converter and jq query tool
    - [ ] `xmlstarlet`: XML format (`fo`) and value selection (`sel -t -v`)
    - [ ] `csvjson` / `in2csv`: CSV to JSON converter
    - [ ] `csvsql`: CSV to SQL table schema and insert script generator
    - [ ] `csvformat`: Custom CSV delimiter and tab formatter
    - [ ] `xlsx2csv`: Excel workbook XML sheet to CSV converter

13. **PDF, PostScript & Office Document Suite**
    - [ ] `pdftotext`: Plaintext extractor from PDF streams
    - [ ] `pdfinfo`: PDF metadata and page count inspector
    - ~~`pdftk`: PDF merge and document builder~~ *(Cannot be done: Requires GCJ / full Java Virtual Machine runtime in browser)*
    - [ ] `qpdf`: PDF linearizer and transform engine
    - ~~`gs` / `ghostscript`: PostScript & PDF rasterization~~ *(Cannot be done: Requires massive monolithic Ghostscript native host runtime)*
    - [ ] `img2pdf`: Direct image to PDF page generator
    - [ ] `pdfimages` & `pdftoppm`: PDF image and page rendering tools
    - ~~`pandoc`: Universal markup converter~~ *(Cannot be done: Requires GHC Haskell runtime / Haskell WASM not supported by Emscripten)*
    - ~~`wkhtmltopdf` & `weasyprint`: HTML/CSS document to PDF converter~~ *(Cannot be done: Requires full headless WebKit / Python GTK stack)*
    - [ ] `enscript` & `a2ps`: Plaintext to PostScript formatter
    - [ ] `antiword`, `docx2txt`, `odt2txt`: Word and OpenDocument text extractors
    - ~~`soffice` / `libreoffice`: Headless document converter~~ *(Cannot be done: Multi-gigabyte office suite requiring full Linux desktop GUI/X11 subsystems)*
    - ~~`ebook-convert`: EPUB/MOBI/HTML to document converter~~ *(Cannot be done: Calibre desktop Qt/Python application requiring full GUI/Qt stack)*

14. **Image Suite**
    - ~~`magick` / `convert`: ImageMagick conversion and processing engine~~ *(Too massive for client bundle; covered by focused native tools below)*
    - ~~`gm`: GraphicsMagick CLI~~ *(Monolithic multi-megabyte engine; covered by focused tools below)*
    - ~~`inkscape`: Vector SVG exporter and renderer~~ *(Cannot be done: Requires GTK3/GIO GUI desktop subsystem)*
    - [ ] `rsvg-convert`: SVG to vector/raster output
    - [ ] `pngtopnm`, `jpegtopnm`, `pnmtojpeg`, `pnmtopng`: Netpbm suite
    - [x] `cwebp` & `dwebp`: WebP encoder/decoder (Google libwebp.wasm)
    - [ ] `avifenc` & `avifdec`: AVIF encoder/decoder
    - [ ] `cjxl` & `djxl`: JPEG XL encoder/decoder
    - [x] `potrace` & `mkbitmap`: Raster to vector SVG tracing and bitmap thresholding (Peter Selinger potrace.wasm / mkbitmap.wasm)
    - [x] `optipng`: Lossless PNG optimizer (optipng.wasm)
    - [ ] `jpegoptim`: Lossless JPEG optimizer

15. **Audio & Video Suite**
    - ~~`ffmpeg`: Full audio/video transcoding and stream processor~~ *(Massive 50MB+ media stack with complex threading)*
    - [ ] `sox`: Sound eXchange audio converter and generator
    - ~~`HandBrakeCLI` / `handbrake`: Video transcoder~~ *(Multi-gigabyte video transcoding pipeline)*
    - [x] `flac` & `metaflac`: Lossless audio encoder, decoder, and metadata editor (Xiph.org flac.wasm / metaflac.wasm)
    - [ ] `oggenc` & `oggdec`: Ogg Vorbis audio encoder/decoder
    - [ ] `opusenc` & `opusdec`: Low-latency Opus audio encoder/decoder
    - [x] `lame`: MP3 audio encoder (LAME 3.100 lame.wasm)
    - ~~`mkvmerge` & `mkvextract`: MKVToolNix Matroska multiplexer and demuxer~~ *(Massive C++ Boost/EBML monolithic suite)*

16. **Disk Images, Packaging & 3D CAD**
    - ~~`qemu-img`: Virtual machine disk image converter~~ *(Cannot be done: Requires OS block device kernel ioctls and virtualization primitives)*
    - [x] `bchunk`: CD/DVD image converter to ISO 9660 (bchunk.wasm)
    - [x] `bin2iso`: CD/DVD image converter to ISO 9660 (bin2iso.wasm)
    - [ ] `iat`: Iso9660 Analyzer Tool
    - ~~`alien`: Linux package converter~~ *(Cannot be done: Requires Perl RPM/Debian dpkg package manager host environment)*
    - [ ] `7z` / `p7zip`: 7-Zip archiver
    - ~~`assimp`: 3D model importer and exporter~~ *(Massive monolithic C++ CAD engine)*
    - ~~`meshlabserver`: 3D mesh batch processor~~ *(Cannot be done: Qt OpenGL GUI dependency)*
    - ~~`openscad`: Solid 3D CAD CSG script compiler~~ *(Cannot be done: CGAL / Qt desktop GUI dependency)*

17. **Linux Essentials**
    - [ ] `file`: Reads magic numbers and headers to reliably identify file types (Ian Darwin file-5.45)
    - [x] `tree`: Recursively renders directory hierarchies with depth limiters and size summaries (Steve Baker tree.wasm)
    - [x] `binutils` (`strings`): Extracts readable strings from compiled binaries (provided by BusyBox `strings` WASM)
    - [ ] `readelf`: Decodes ELF headers and lists exported symbols from shared libraries
