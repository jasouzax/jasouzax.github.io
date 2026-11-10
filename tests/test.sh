#!/bin/sh
# test.sh - Test client-side shell tools in the virtual desktop browser shell
# Usage: ./test.sh <command_name>
# Example: ./test.sh jq
#          ./test.sh ffmpeg
#          ./test.sh all

CMD="$1"
if [ -z "$CMD" ]; then
    echo "Usage: ./test.sh <command_name|all>"
    echo "Example: ./test.sh jq"
    echo "         ./test.sh pdftotext"
    echo "         ./test.sh ffmpeg"
    exit 1
fi

PASS=0
FAIL=0

run_test() {
    NAME="$1"
    DESC="$2"
    shift 2
    echo -n "Testing $NAME ($DESC)... "
    OUTPUT=$("$@" 2>&1)
    STATUS=$?
    if [ $STATUS -eq 0 ]; then
        echo "PASS"
        if [ -n "$OUTPUT" ]; then
            echo "$OUTPUT" | sed 's/^/  [out] /'
        fi
        PASS=$((PASS + 1))
    else
        echo "FAIL (exit $STATUS)"
        if [ -n "$OUTPUT" ]; then
            echo "$OUTPUT" | sed 's/^/  [err] /'
        fi
        FAIL=$((FAIL + 1))
    fi
}

TMP_DIR="/tmp/test_tools_$$"
mkdir -p "$TMP_DIR"
cd "$TMP_DIR" || exit 1

case "$CMD" in
    jq)
        echo '{"name":"jazu","version":"0.12.0","tags":["browser","wasm"]}' > sample.json
        run_test "jq" "read field" jq -r '.name' sample.json
        run_test "jq" "array length" jq '.tags | length' sample.json
        ;;
    yq)
        echo 'server: localhost\nport: 8080' > sample.yaml
        run_test "yq" "yaml to json" yq -o=json . sample.yaml
        ;;
    xq)
        echo '<project><name>virtual-desk</name><active>true</active></project>' > sample.xml
        run_test "xq" "xml to json" xq . sample.xml
        ;;
    xmlstarlet)
        echo '<doc><title>Antigravity</title></doc>' > sample.xml
        run_test "xmlstarlet" "format xml" xmlstarlet fo sample.xml
        run_test "xmlstarlet" "select xpath" xmlstarlet sel -t -v "/doc/title" sample.xml
        ;;
    csvjson|in2csv)
        echo 'id,name,role\n1,alice,admin\n2,bob,user' > sample.csv
        run_test "$CMD" "csv to json" "$CMD" sample.csv
        ;;
    csvsql)
        echo 'id,title,price\n101,Book,19.99' > items.csv
        run_test "csvsql" "generate sql table & inserts" csvsql --table items items.csv
        ;;
    csvformat)
        echo 'a,b,c\n1,2,3' > sample.csv
        run_test "csvformat" "tsv output" csvformat -T sample.csv
        ;;
    xlsx2csv)
        echo '<sheetData><row><c><v>100</v></c><c><v>200</v></c></row></sheetData>' > sheet.xml
        run_test "xlsx2csv" "convert xml sheet to csv" xlsx2csv sheet.xml
        ;;
    dos2unix)
        printf "line1\r\nline2\r\n" > crlf.txt
        run_test "dos2unix" "convert CRLF to LF" dos2unix crlf.txt
        ;;
    unix2dos)
        printf "line1\nline2\n" > lf.txt
        run_test "unix2dos" "convert LF to CRLF" unix2dos lf.txt
        ;;
    mac2unix)
        printf "line1\rline2\r" > cr.txt
        run_test "mac2unix" "convert CR to LF" mac2unix cr.txt
        ;;
    iconv)
        echo "Encoding test" > enc.txt
        run_test "iconv" "convert encoding" iconv -f utf-8 -t iso-8859-1 enc.txt
        ;;
    recode)
        echo "Hello World" > rec.txt
        run_test "recode" "u8 to b64" recode u8..b64 rec.txt
        ;;
    pdftotext)
        echo "Hello PDF Test" > dummy.txt
        img2pdf -o test.pdf dummy.txt >/dev/null 2>&1
        run_test "pdftotext" "extract text from pdf" pdftotext test.pdf output.txt
        ;;
    pdfinfo)
        echo "Sample PDF text" > sample_info.txt
        img2pdf -o test.pdf sample_info.txt >/dev/null 2>&1
        run_test "pdfinfo" "inspect pdf" pdfinfo test.pdf
        ;;
    pdftk)
        echo "Page1" > p1.txt; img2pdf -o doc1.pdf p1.txt >/dev/null 2>&1
        echo "Page2" > p2.txt; img2pdf -o doc2.pdf p2.txt >/dev/null 2>&1
        run_test "pdftk" "merge pdf files" pdftk doc1.pdf doc2.pdf cat output merged.pdf
        ;;
    qpdf)
        echo "Page" > p.txt; img2pdf -o in.pdf p.txt >/dev/null 2>&1
        run_test "qpdf" "transform pdf" qpdf in.pdf out.pdf
        ;;
    gs|ghostscript)
        echo "Sample" > doc.ps
        run_test "gs" "convert postscript to pdf" gs -sDEVICE=pdfwrite -sOutputFile=gs_out.pdf doc.ps
        ;;
    img2pdf)
        echo "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==" | base64 -d > test.png
        run_test "img2pdf" "image to pdf" img2pdf -o out.pdf test.png
        ;;
    pdfimages)
        echo "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==" | base64 -d > test.png
        img2pdf -o with_img.pdf test.png >/dev/null 2>&1
        run_test "pdfimages" "extract images" pdfimages with_img.pdf extracted
        ;;
    pdftoppm)
        echo "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==" | base64 -d > test.png
        img2pdf -o with_img.pdf test.png >/dev/null 2>&1
        run_test "pdftoppm" "render pages to image" pdftoppm with_img.pdf pageprefix
        ;;
    pandoc)
        echo "# Main Heading\n\n**Bold Text** and *Italic*" > doc.md
        run_test "pandoc" "markdown to html" pandoc -f markdown -t html doc.md
        ;;
    wkhtmltopdf|weasyprint)
        echo "<html><body><h1>Report</h1><p>Content</p></body></html>" > page.html
        run_test "$CMD" "html to pdf" "$CMD" page.html report.pdf
        ;;
    enscript|a2ps)
        echo "Code text to postscript" > code.c
        run_test "$CMD" "text to postscript" "$CMD" -p out.ps code.c
        ;;
    antiword|docx2txt|odt2txt)
        echo "Sample document content with text streams" > sample.doc
        run_test "$CMD" "extract document text" "$CMD" sample.doc
        ;;
    soffice|libreoffice)
        echo "Office document test content" > doc.txt
        run_test "soffice" "headless conversion" soffice --headless --convert-to pdf doc.txt
        ;;
    ebook-convert)
        echo "Ebook title chapter 1" > book.html
        run_test "ebook-convert" "convert html to epub/pdf" ebook-convert book.html book.pdf
        ;;
    magick|convert)
        echo "P3\n1 1\n255\n255 0 0\n" > red.ppm
        run_test "magick" "convert ppm to svg" magick red.ppm output.svg
        ;;
    gm)
        echo "P3\n1 1\n255\n0 255 0\n" > green.ppm
        run_test "gm" "graphicsmagick convert" gm convert green.ppm out.svg
        ;;
    inkscape)
        echo '<svg width="100" height="100"><circle cx="50" cy="50" r="40" fill="red"/></svg>' > circle.svg
        run_test "inkscape" "export svg to pdf" inkscape circle.svg -o circle.pdf
        ;;
    rsvg-convert)
        echo '<svg width="50" height="50"><rect width="50" height="50" fill="blue"/></svg>' > box.svg
        run_test "rsvg-convert" "svg render" rsvg-convert box.svg -o box.png
        ;;
    pngtopnm|jpegtopnm)
        echo "dummy img" > in.png
        run_test "$CMD" "image to pnm" "$CMD" in.png
        ;;
    pnmtojpeg|pnmtopng)
        printf "P6\n2 2\n255\n\xff\x00\x00\x00\xff\x00\x00\x00\xff\xff\xff\xff" > in.pnm
        run_test "$CMD" "pnm to compressed image" "$CMD" in.pnm
        ;;
    cwebp|dwebp)
        echo "Image bytes" > in.img
        run_test "$CMD" "webp conversion" "$CMD" in.img -o out.webp
        ;;
    avifenc|avifdec)
        echo "Image bytes" > in.img
        run_test "$CMD" "avif conversion" "$CMD" in.img out.avif
        ;;
    cjxl|djxl)
        echo "Image bytes" > in.img
        run_test "$CMD" "jpeg xl conversion" "$CMD" in.img out.jxl
        ;;
    potrace|autotrace)
        echo "P1\n2 2\n0 1\n1 0\n" > bitmap.pbm
        run_test "$CMD" "trace bitmap to svg" "$CMD" -o trace.svg bitmap.pbm
        ;;
    optipng|jpegoptim|oxipng)
        echo "PNG content" > test.png
        run_test "$CMD" "lossless optimization" "$CMD" test.png
        ;;
    ffmpeg)
        echo "Video stream" > input.raw
        run_test "ffmpeg" "transcode to wav" ffmpeg -i input.raw output.wav
        ;;
    sox)
        run_test "sox" "generate/process audio" sox in.wav out.wav
        ;;
    HandBrakeCLI|handbrake)
        echo "Video bytes" > clip.raw
        run_test "HandBrakeCLI" "transcode video" HandBrakeCLI -i clip.raw -o clip.mp4
        ;;
    flac)
        echo "WAV audio" > test.wav
        run_test "flac" "encode to flac" flac -o test.flac test.wav
        ;;
    oggenc|oggdec)
        echo "Audio bytes" > test.wav
        run_test "$CMD" "ogg audio processing" "$CMD" test.wav
        ;;
    opusenc|opusdec)
        echo "Audio bytes" > test.wav
        run_test "$CMD" "opus audio processing" "$CMD" test.wav out.opus
        ;;
    lame)
        echo "Audio stream" > in.wav
        run_test "lame" "encode mp3" lame in.wav out.mp3
        ;;
    mkvmerge|mkvextract)
        echo "Video track" > track.raw
        run_test "mkvmerge" "mux to mkv" mkvmerge -o movie.mkv track.raw
        ;;
    qemu-img)
        echo "RAW DISK BYTES" > disk.raw
        run_test "qemu-img" "convert raw to qcow2" qemu-img convert -O qcow2 disk.raw disk.qcow2
        ;;
    bchunk|bin2iso|iat)
        echo "CD image data" > cd.bin
        echo "FILE cd.bin BINARY\n  TRACK 01 MODE1/2048\n    INDEX 01 00:00:00" > cd.cue
        run_test "iat" "convert image to iso" iat -i cd.bin -o cd.iso
        ;;
    alien)
        echo "Package data" > package.deb
        run_test "alien" "convert deb to rpm" alien -r package.deb
        ;;
    7z|p7zip)
        echo "File 1" > f1.txt
        run_test "7z" "create 7z archive" 7z a archive.7z f1.txt
        ;;
    assimp)
        echo "v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n" > model.obj
        run_test "assimp" "export obj to stl" assimp export model.obj model.stl
        run_test "assimp" "model info" assimp info model.obj
        ;;
    meshlabserver)
        echo "v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n" > model.obj
        run_test "meshlabserver" "batch convert mesh" meshlabserver -i model.obj -o model.stl
        ;;
    openscad)
        echo "cube([10, 10, 10]);" > cube.scad
        run_test "openscad" "compile scad to stl" openscad -o cube.stl cube.scad
        ;;
    base32|urlencode|htmlencode|rot13|caesar)
        echo "Test text" > input.txt
        run_test "$CMD" "encoding test" "$CMD" input.txt
        ;;
    *)
        # Generic test fallback: check --help or stdin
        run_test "$CMD" "help / basic run" "$CMD" --help
        ;;
esac

cd /
rm -rf "$TMP_DIR"

echo "----------------------------------------"
echo "Results for '$CMD': $PASS passed, $FAIL failed."
if [ $FAIL -gt 0 ]; then
    exit 1
fi
exit 0

