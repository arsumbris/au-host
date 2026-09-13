_au_prompt_render() {
  local status=${_au_prompt_status:-0} branch='' dirty='' environment='' elapsed=0 width=$((COLUMNS / 2))
  ((width < 12)) && width=12
  if [[ $AU_PROMPT_PRESET == compact-git || $AU_PROMPT_PRESET == clean || $AU_PROMPT_PRESET == context ]]; then
    branch=$(command git symbolic-ref --quiet --short HEAD 2>/dev/null) || branch=$(command git rev-parse --short HEAD 2>/dev/null)
    if [[ -n $branch ]]; then
      [[ -n $(GIT_OPTIONAL_LOCKS=0 command git status --porcelain --untracked-files=no 2>/dev/null) ]] && dirty='*'
      branch=${branch:0:width}$dirty
    fi
  fi
  _au_prompt_branch=${branch:+ · $branch}
  _au_prompt_context=''
  if [[ $AU_PROMPT_PRESET == context ]]; then
    environment=${VIRTUAL_ENV##*/}
    environment=${CONDA_DEFAULT_ENV:-$environment}
    _au_prompt_context=${environment:+ · $environment}
    (( status != 0 )) && _au_prompt_context="$_au_prompt_context · exit $status"
  fi
  if [[ $AU_PROMPT_PRESET == context && ${_au_prompt_started:--1} -ge 0 ]]; then
    elapsed=$((SECONDS - _au_prompt_started))
    ((elapsed >= 5)) && _au_prompt_context="$_au_prompt_context · ${elapsed}s"
  fi
  _au_prompt_started=-1
  local marker='❯'
  (( EUID == 0 )) && marker='#'
  (( status != 0 )) && marker='\[\e[31m\]'"$marker"'\[\e[0m\]'
  case $AU_PROMPT_PRESET in
    raw) PS1='\$ ' ;;
    minimal) PS1='\[\e[90m\]\W\[\e[0m\] '"$marker " ;;
    compact-git) PS1='\[\e[90m\]\W${_au_prompt_branch}\[\e[0m\] '"$marker " ;;
    *) PS1='\[\e[90m\]\w${_au_prompt_branch}${_au_prompt_context}\[\e[0m\]\n'"$marker " ;;
  esac
  _au_prompt_ready=1
}
_au_prompt_capture() { _au_prompt_status=$?; return "$_au_prompt_status"; }
# Time commands when the shell has no existing DEBUG integration to preserve.
if [[ -z $(trap -p DEBUG) ]]; then
  trap 'if [[ ${_au_prompt_ready:-0} == 1 && $BASH_COMMAND != _au_prompt_capture ]]; then _au_prompt_started=$SECONDS; _au_prompt_ready=0; fi' DEBUG
fi
# Capture command status before user prompt hooks, then apply presentation last.
if [[ $(declare -p PROMPT_COMMAND 2>/dev/null) == 'declare -a'* ]]; then
  PROMPT_COMMAND=('_au_prompt_capture' "${PROMPT_COMMAND[@]}" '_au_prompt_render')
else
  PROMPT_COMMAND="_au_prompt_capture; ${PROMPT_COMMAND:+$PROMPT_COMMAND; }_au_prompt_render"
fi
PROMPT_DIRTRIM=2
