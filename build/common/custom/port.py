"""Reproducible browser-platform patches for the pinned upstream sources."""
from pathlib import Path
import sys
root = Path(sys.argv[1])
p = root / 'fastfetch-2.40.4/CMakeLists.txt'
s = p.read_text().replace('elseif("${CMAKE_SYSTEM_NAME}" STREQUAL "Linux")', 'elseif("${CMAKE_SYSTEM_NAME}" STREQUAL "Linux" OR EMSCRIPTEN)')
p.write_text(s)
p = root / 'fastfetch-2.40.4/src/logo/image/image.c'
p.write_text(p.read_text().replace('#elif __linux__', '#elif defined(__linux__) && !defined(__EMSCRIPTEN__)').replace('#ifdef __linux__', '#if defined(__linux__) && !defined(__EMSCRIPTEN__)'))
p = root / 'fastfetch-2.40.4/src/detection/localip/localip_linux.c'
p.write_text('#include "localip.h"\nconst char* ffDetectLocalIps(const FFLocalIpOptions* options, FFlist* results) { (void)options; (void)results; return "Browser network interfaces are not exposed"; }\n')

htop = root / 'htop-3.4.1/unsupported'
p = htop / 'UnsupportedProcessTable.c'
s = p.read_text()
s = s[:s.index('void ProcessTable_goThroughEntries(')] + (Path(__file__).parent / 'htop_processes.c').read_text()
p.write_text('#include <dirent.h>\n#include <stdio.h>\n' + s)
p = htop / 'UnsupportedMachine.c'
s = p.read_text().replace('#include <stdlib.h>', '#include <stdlib.h>\n#include <sys/sysinfo.h>')
s = s.replace('super->existingCPUs = 1;', 'super->existingCPUs = get_nprocs();').replace('super->activeCPUs = 1;', 'super->activeCPUs = super->existingCPUs;')
s = s.replace('super->totalMem = 0;', 'struct sysinfo info; sysinfo(&info);\n   super->totalMem = (unsigned long long) info.totalram * info.mem_unit / 1024;')
s = s.replace('super->usedMem = 0;', 'super->usedMem = (unsigned long long)(info.totalram-info.freeram) * info.mem_unit / 1024;').replace('super->availableMem = 0;', 'super->availableMem = super->totalMem-super->usedMem;')
p.write_text(s)
p = htop / 'Platform.c'
s = p.read_text().replace('#include <math.h>', '#include <math.h>\n#include <sys/sysinfo.h>\n#include <unistd.h>')
s = s.replace('return 0;\n}\n\nvoid Platform_getLoadAverage', 'struct sysinfo info; sysinfo(&info); return info.uptime;\n}\n\nvoid Platform_getLoadAverage')
s = s.replace('*used = 1337;', '*used = NAN;').replace('*max = 4711;', '*max = NAN;')
s = s.replace('String_safeStrncpy(buffer, Platform_unsupported, size);', 'gethostname(buffer, size);')
s = s.replace('xStrdup(Platform_unsupported)', 'xStrdup("Jazu browser kernel")')
s = s.replace('void Platform_setMemoryValues(Meter* this) {\n   (void) this;\n}', '''void Platform_setMemoryValues(Meter* this) {
   this->total = this->host->totalMem;
   this->values[MEMORY_METER_USED] = this->host->usedMem;
   this->values[MEMORY_METER_AVAILABLE] = this->host->availableMem;
}''')
s = s.replace('{ .name = " 0 Cancel",    .number =  0 },', '{ .name = " 0 Cancel", .number = 0 },\n   { .name = " 2 SIGINT", .number = 2 },\n   { .name = " 9 SIGKILL", .number = 9 },\n   { .name = "15 SIGTERM", .number = 15 },')
p.write_text(s)
