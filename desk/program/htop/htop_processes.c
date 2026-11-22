/* Native Htop portable backend, populated from the browser kernel's /proc. */
void ProcessTable_goThroughEntries(ProcessTable* super) {
   DIR* directory = opendir("/proc");
   if (!directory) return;
   struct dirent* entry;
   while ((entry = readdir(directory))) {
      char* end;
      long pid = strtol(entry->d_name, &end, 10);
      if (pid <= 0 || *end) continue;
      char path[128], line[512], name[256] = "wasm", command[2048] = "";
      unsigned int uid = 1000;
      int parent = 0;
      char state = 'R';
      snprintf(path, sizeof(path), "/proc/%ld/status", pid);
      FILE* file = fopen(path, "r");
      if (!file) continue;
      while (fgets(line, sizeof(line), file)) {
         if (!strncmp(line,"Name:",5)) sscanf(line+5," %255[^\n]",name);
         else if (!strncmp(line,"PPid:",5)) parent = atoi(line+5);
         else if (!strncmp(line,"Uid:",4)) uid = strtoul(line+4,NULL,10);
         else if (!strncmp(line,"State:",6)) sscanf(line+6," %c",&state);
      }
      fclose(file);
      snprintf(path,sizeof(path),"/proc/%ld/cmdline",pid);
      file = fopen(path,"r");
      if (file) { size_t length = fread(command,1,sizeof(command)-1,file); fclose(file); for(size_t i=0;i<length;i++) if (!command[i]) command[i]=' '; command[length]=0; }
      bool preExisting = true;
      Process* proc = ProcessTable_getProcess(super,(pid_t)pid,&preExisting,UnsupportedProcess_new);
      Process_setPid(proc,(pid_t)pid); Process_setParent(proc,parent); Process_setThreadGroup(proc,(pid_t)pid);
      Process_updateComm(proc,name); Process_updateCmdline(proc,*command ? command : name,0,0); Process_updateExe(proc,name);
      proc->super.updated = true; proc->super.show = true;
      proc->state = state == 'Z' ? ZOMBIE : RUNNING;
      proc->isKernelThread = false; proc->isUserlandThread = false;
      proc->pgrp = pid; proc->session = 0; proc->tty_nr = 0; proc->tpgid = 0; proc->processor = 0;
      proc->percent_cpu = 0; proc->percent_mem = 0; proc->time = 0;
      proc->st_uid = uid; proc->user = UsersTable_getRef(super->super.host->usersTable,uid);
      proc->priority = 0; proc->nice = 0; proc->nlwp = 1; proc->m_virt = 0; proc->m_resident = 0; proc->minflt = 0; proc->majflt = 0;
      super->totalTasks++; if (state != 'Z') super->runningTasks++;
      if (!preExisting) ProcessTable_add(super,proc);
   }
   closedir(directory);
}
