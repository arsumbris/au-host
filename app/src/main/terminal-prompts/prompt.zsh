# App-session prompt. Context is expanded through psvar, not evaluated as shell code.
_au_prompt_capture() {
  _au_prompt_status=$?
  return 0
}
_au_prompt_render() {
  local elapsed=0 branch='' dirty='' environment=''
  (( _au_prompt_started >= 0 )) && elapsed=$(( SECONDS - _au_prompt_started ))
  _au_prompt_started=-1
  local width=$(( COLUMNS / 2 ))
  (( width < 12 )) && width=12
  local prompt_path="%${width}<…<%~%<<"
  if [[ $AU_PROMPT_PRESET == minimal ]]; then prompt_path='%1~'; fi
  if [[ $AU_PROMPT_PRESET == compact-git || $AU_PROMPT_PRESET == clean || $AU_PROMPT_PRESET == context ]]; then
    branch=$(command git symbolic-ref --quiet --short HEAD 2>/dev/null) || branch=$(command git rev-parse --short HEAD 2>/dev/null)
    if [[ -n $branch ]]; then
      [[ -n $(GIT_OPTIONAL_LOCKS=0 command git status --porcelain --untracked-files=no 2>/dev/null) ]] && dirty='*'
      branch=${branch[1,$width]}$dirty
    fi
  fi
  psvar[42]=$branch
  psvar[43]=''
  if [[ $AU_PROMPT_PRESET == context ]]; then
    [[ -n $VIRTUAL_ENV ]] && environment=${VIRTUAL_ENV:t}
    [[ -n $CONDA_DEFAULT_ENV ]] && environment=$CONDA_DEFAULT_ENV
    psvar[43]=$environment
    (( elapsed >= 5 )) && psvar[43]="${psvar[43]:+${psvar[43]} · }${elapsed}s"
    (( _au_prompt_status != 0 )) && psvar[43]="${psvar[43]:+${psvar[43]} · }exit ${_au_prompt_status}"
  fi
  local marker='%(#.#.❯)'
  (( _au_prompt_status != 0 )) && marker="%F{red}${marker}%f"
  RPROMPT=''
  case $AU_PROMPT_PRESET in
    raw) PROMPT='%(#.#.$) ' ;;
    minimal) PROMPT="%F{8}${prompt_path}%f ${marker} " ;;
    compact-git) PROMPT="%F{8}${prompt_path}%(42V. · %42v.)%f ${marker} " ;;
    *) PROMPT="%F{8}${prompt_path}%(42V. · %42v.)%(43V. · %43v.)%f"$'\n'"${marker} " ;;
  esac
}
_au_prompt_preexec() { _au_prompt_started=$SECONDS; }
# Keep user hooks, then apply the selected app prompt after their presentation hooks.
typeset -ga precmd_functions preexec_functions
precmd_functions=(_au_prompt_capture ${precmd_functions:#_au_prompt_*} _au_prompt_render)
preexec_functions=(${preexec_functions:#_au_prompt_preexec} _au_prompt_preexec)
_au_prompt_started=-1
