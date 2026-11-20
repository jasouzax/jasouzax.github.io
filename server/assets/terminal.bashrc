# Load the account's usual interactive configuration before choosing the terminal prompt.
if [ -f "$HOME/.bashrc" ]; then . "$HOME/.bashrc"; fi
# Bash expands the real account, hostname and current working directory on each prompt.
PS1='\u@\h:$PWD\$ '
