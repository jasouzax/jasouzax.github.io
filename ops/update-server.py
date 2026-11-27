"""Update the existing Pi services without replacing their data or configuration.

Requires Python + paramiko locally, Node/npm in the checkout, and Docker over SSH.
SSH keys are preferred; otherwise the password is requested without echoing it.
"""
import argparse
import getpass
import hashlib
import json
import pathlib
import shlex
import subprocess
import tarfile
import time

import paramiko

ROOT = pathlib.Path(__file__).resolve().parents[1]

REMOTE = r'''
import http.client,json,os,pathlib,shutil,socket,subprocess,sys,time
directory=pathlib.Path(sys.argv[1]).resolve()
revision=sys.argv[2]
assert str(directory).startswith('/home/jason/deploy-updates/') and len(revision)==40
os.umask(0o077)
def run(*args):
    subprocess.run(args,check=True)
def inspect(name):
    return json.loads(subprocess.check_output(['docker','inspect',name]))[0]
class Docker(http.client.HTTPConnection):
    def connect(self):
        self.sock=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM)
        self.sock.connect('/var/run/docker.sock')
def api(method,path,body=None):
    conn=Docker('localhost',timeout=120)
    conn.request(method,'/v1.47'+path,json.dumps(body) if body is not None else None,{'Content-Type':'application/json'})
    response=conn.getresponse(); text=response.read().decode();conn.close()
    if response.status>=300: raise RuntimeError('Docker '+path+': '+text)
    return json.loads(text) if text else None
names=['jazu-personal','jazu-server-staging','jazu-server-production']
before={name:inspect(name) for name in names}
build_changed=any(p.is_file() for p in (directory/'payload/build').rglob('*'))
if not build_changed and all(value['Config'].get('Labels',{}).get('org.opencontainers.image.revision')==revision and value['State']['Running'] for value in before.values()) and subprocess.check_output(['git','-C','/home/jason/jazu-docker/work/jazu','rev-parse','HEAD']).decode().strip()==revision:
    print('All services already run '+revision,flush=True)
    sys.exit(0)
if shutil.disk_usage('/home/jason').free < 512*1024*1024: raise RuntimeError('At least 512 MiB free space is required; review unused build cache first')
for name,value in before.items():
    (directory/(name+'.before.json')).write_text(json.dumps(value,indent=2))
tag=revision[:12]
for kind in ['personal','agent']:
    image=('jazu-personal:' if kind=='personal' else 'jazu-server:')+tag
    existing=subprocess.run(['docker','image','inspect',image],capture_output=True,text=True)
    if not (kind=='personal' and build_changed) and existing.returncode==0 and json.loads(existing.stdout)[0]['Config'].get('Labels',{}).get('org.opencontainers.image.revision')==revision:
        print('Reusing verified candidate image '+image,flush=True)
        continue
    base=before['jazu-personal' if kind=='personal' else 'jazu-server-staging']['Config']['Image']
    original=json.loads(subprocess.check_output(['docker','image','inspect',base]))[0]['Config']
    temporary='jazu-update-'+kind+'-'+tag
    work='/opt/jazu' if kind=='personal' else '/app'
    run('docker','create','--name',temporary,'--user','root','--network','host','--entrypoint','sh',base,'-c','cd '+work+' && npm install --omit=dev --ignore-scripts --no-audit --no-fund && npm cache clean --force')
    try:
        if kind=='personal':
            run('docker','cp',str(directory/'payload')+'/.',temporary+':/opt/jazu/')
        else:
            for name in ['package.json','package-lock.json']:
                run('docker','cp',str(directory/'payload/server'/name),temporary+':/app/'+name)
            run('docker','cp',str(directory/'agent-dist')+'/.',temporary+':/app/dist/')
            run('docker','cp',str(directory/'payload/server/assets')+'/.',temporary+':/app/assets/')
            for name in ['restart.smoke.cjs','terminal.smoke.cjs','interaction.smoke.cjs']:
                run('docker','cp',str(directory/'payload/server/test'/name),temporary+':/app/test/'+name)
        run('docker','start','--attach',temporary)
        if inspect(temporary)['State']['ExitCode']!=0: raise RuntimeError('Dependency update failed')
        # Restore the original image startup command/user; never bake runtime secrets into an image.
        run('docker','commit','--change','USER '+original['User'],'--change','WORKDIR '+original['WorkingDir'],
            '--change','ENTRYPOINT '+json.dumps(original.get('Entrypoint') or []),
            '--change','CMD '+json.dumps(original.get('Cmd') or []),
            '--change','LABEL org.opencontainers.image.revision='+revision,temporary,image)
    finally:
        run('docker','rm','--volumes',temporary)
for test in ['restart.smoke.cjs','terminal.smoke.cjs']:
    run('docker','run','--rm','--init','--network','none','--hostname','jasouza','--entrypoint','node','jazu-server:'+tag,'test/'+test)

checkout='/home/jason/jazu-docker/work/jazu'
(directory/'checkout-before.json').write_text(json.dumps({'revision':subprocess.check_output(['git','-C',checkout,'rev-parse','HEAD']).decode().strip(),'branch':subprocess.check_output(['git','-C',checkout,'branch','--show-current']).decode().strip()}))
run('git','-C',checkout,'fetch','origin','master','staging')
if subprocess.check_output(['git','-C',checkout,'rev-parse','origin/master']).decode().strip()!=revision: raise RuntimeError('Remote master changed during deployment')
if subprocess.check_output(['git','-C',checkout,'diff','--name-only']).strip() or subprocess.check_output(['git','-C',checkout,'diff','--cached','--name-only']).strip(): raise RuntimeError('Server checkout has tracked edits')

updated=[]
try:
    # The listener is stopped while its source is advanced; untracked files remain.
    run('docker','stop','--time','60','jazu-personal')
    run('git','-C',checkout,'merge','--ff-only',revision)
    for source in (directory/'payload/build').rglob('*'):
        if not source.is_file(): continue
        target=pathlib.Path(checkout)/'build'/source.relative_to(directory/'payload/build')
        target.parent.mkdir(parents=True,exist_ok=True)
        if target.is_symlink(): target.unlink()
        shutil.copy2(source,target)
    for name in names:
        old=before[name]; backup=name+'-before-'+tag+'-'+str(int(time.time()))
        if not (name=='jazu-personal' and build_changed) and old['Config'].get('Labels',{}).get('org.opencontainers.image.revision')==revision:
            if not inspect(name)['State']['Running']: run('docker','start',name)
            print(name+' already runs '+revision,flush=True)
            continue
        if subprocess.run(['docker','container','inspect',backup],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode==0: raise RuntimeError('Rollback container already exists: '+backup)
        if inspect(name)['State']['Running']: run('docker','stop','--time','60',name)
        run('docker','rename',name,backup)
        config=old['Config'].copy()
        config['Image']=('jazu-personal:' if name=='jazu-personal' else 'jazu-server:')+tag
        config['Labels']={**(config.get('Labels') or {}),'org.opencontainers.image.revision':revision}
        config['HostConfig']=old['HostConfig'].copy()
        config['HostConfig'].pop('ContainerIDFile',None)
        try:
            api('POST','/containers/create?name='+name,config)
            run('docker','start',name)
            updated.append((name,backup))
            deadline=time.time()+300
            while True:
                current=inspect(name)
                if not current['State']['Running']: raise RuntimeError(name+' exited')
                if name!='jazu-personal' or current['State'].get('Health',{}).get('Status')=='healthy': break
                if time.time()>deadline: raise RuntimeError(name+' did not become healthy')
                time.sleep(3)
            time.sleep(8)
            current=inspect(name)
            if not current['State']['Running'] or current['RestartCount']: raise RuntimeError(name+' restarted unexpectedly')
            if sorted((m['Source'],m['Destination']) for m in current['Mounts'])!=sorted((m['Source'],m['Destination']) for m in old['Mounts']): raise RuntimeError('Mounts changed for '+name)
            print(json.dumps({'service':name,'revision':revision,'image':current['Config']['Image'],'state':current['State']['Status'],'health':current['State'].get('Health',{}).get('Status'),'rollback':backup}),flush=True)
        except Exception:
            subprocess.run(['docker','rm','-f',name],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
            run('docker','rename',backup,name);run('docker','start',name)
            raise
except Exception:
    print('Deployment stopped; previous containers/configuration were retained for rollback.',file=sys.stderr)
    if not inspect('jazu-personal')['State']['Running']: run('docker','start','jazu-personal')
    raise
(directory/'result.json').write_text(json.dumps({'revision':revision,'updated':updated},indent=2))
'''

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--host', default='192.168.1.22')
    parser.add_argument('--user', default='jason')
    args = parser.parse_args()
    revision = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    remote = subprocess.check_output(['git', 'ls-remote', 'origin', 'refs/heads/master'], cwd=ROOT, text=True).split()[0]
    if revision != remote:
        raise RuntimeError('HEAD must match GitHub master')
    subprocess.run(['node', 'build.cjs'], cwd=ROOT / 'server', check=True)
    directory = ROOT / '.cache' / 'live-update'
    directory.mkdir(parents=True, exist_ok=True)
    archive = directory / ('server-' + revision[:12] + '.tar.gz')
    tracked = subprocess.check_output(['git', 'ls-files', '-z'], cwd=ROOT).decode().split('\0')
    roots = {'src','engine','desk','cloud','shared','server','ops','content'}
    files = {'package.json','package-lock.json','config.json','tsconfig.json'}
    ssh = paramiko.SSHClient()
    ssh.load_system_host_keys()
    # The first connection asks SSH to trust this host explicitly via the normal ssh command.
    ssh.set_missing_host_key_policy(paramiko.RejectPolicy())
    try:
        ssh.connect(args.host, username=args.user, timeout=15)
    except paramiko.AuthenticationException:
        ssh.connect(args.host, username=args.user, password=getpass.getpass('SSH password: '), timeout=15, look_for_keys=False, allow_agent=False)
    try:
        probe = "import pathlib,hashlib,json; root=pathlib.Path('/opt/jazu/build'); print(json.dumps({str(p.relative_to(root)):hashlib.sha256(p.read_bytes()).hexdigest() for p in root.rglob('*') if p.is_file()}))"
        _, stdout, stderr = ssh.exec_command('docker exec jazu-personal python3 -c ' + shlex.quote(probe))
        hashes = json.loads(stdout.read())
        if stdout.channel.recv_exit_status(): raise RuntimeError('Cannot inspect existing WASM inputs')
        changed_build = [path for path in (ROOT / 'build').rglob('*') if path.is_file() and hashes.get(path.relative_to(ROOT / 'build').as_posix()) != hashlib.sha256(path.read_bytes()).hexdigest()]
        print('Prepared WASM/build changes:', len(changed_build), 'files', flush=True)
        with tarfile.open(archive, 'w:gz') as output:
            for name in tracked:
                path = pathlib.PurePosixPath(name)
                if name and (path.parts[0] in roots or name in files) and not name.startswith(('content/media/', 'cloud/infra/')):
                    output.add(ROOT / name, arcname='payload/' + name, recursive=False)
            output.add(ROOT / 'server' / 'dist', arcname='agent-dist')
            for path in changed_build:
                output.add(path, arcname='payload/build/' + path.relative_to(ROOT / 'build').as_posix())
        remote_dir = f'/home/{args.user}/deploy-updates/{revision[:12]}-{int(time.time())}'
        def run(command):
            _, stdout, stderr = ssh.exec_command(command)
            # Both streams must be drained while a long Docker build runs.
            channel = stdout.channel
            while not channel.exit_status_ready() or channel.recv_ready() or channel.recv_stderr_ready():
                if channel.recv_ready(): print(channel.recv(65536).decode(errors='replace'), end='', flush=True)
                if channel.recv_stderr_ready(): print(channel.recv_stderr(65536).decode(errors='replace'), end='', flush=True)
                time.sleep(0.1)
            if channel.recv_exit_status(): raise RuntimeError('Remote command failed')
        run('mkdir -p ' + shlex.quote(remote_dir) + ' && chmod 700 ' + shlex.quote(remote_dir))
        with ssh.open_sftp() as sftp:
            sftp.put(str(archive), remote_dir + '/payload.tar.gz')
            with sftp.open(remote_dir + '/update.py', 'w') as stream: stream.write(REMOTE)
        run('tar -xzf ' + shlex.quote(remote_dir + '/payload.tar.gz') + ' -C ' + shlex.quote(remote_dir))
        run('python3 ' + shlex.quote(remote_dir + '/update.py') + ' ' + shlex.quote(remote_dir) + ' ' + revision)
        print('Deployment record and rollback configuration:', remote_dir)
    finally:
        ssh.close()

if __name__ == '__main__':
    main()
