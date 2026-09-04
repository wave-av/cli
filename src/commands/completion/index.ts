// cspell:ignore COMPREPLY CWORD compgen compdef esac
import { Command } from "commander";
import { wrapCommand } from "../../lib/errors.js";

/**
 * Shell completion scripts for the WAVE CLI.
 *
 * Usage:
 *   eval "$(wave completion bash)"
 *   eval "$(wave completion zsh)"
 *   wave completion fish | source
 */
export function registerCompletionCommands(program: Command): void {
  const completion = program.command("completion").description("Generate shell completion scripts");

  completion
    .command("bash")
    .description("Generate bash completion script")
    .action(
      wrapCommand(async () => {
        console.log(generateBashCompletion(program));
      }),
    );

  completion
    .command("zsh")
    .description("Generate zsh completion script")
    .action(
      wrapCommand(async () => {
        console.log(generateZshCompletion(program));
      }),
    );

  completion
    .command("fish")
    .description("Generate fish completion script")
    .action(
      wrapCommand(async () => {
        console.log(generateFishCompletion(program));
      }),
    );
}

function getCommandNames(program: Command): string[] {
  return program.commands.map((cmd) => cmd.name());
}

function generateBashCompletion(program: Command): string {
  const commands = getCommandNames(program);
  return `# WAVE CLI bash completion
# Add to ~/.bashrc: eval "$(wave completion bash)"

_wave_completions() {
  local cur prev commands
  COMPREPLY=()
  cur="\${COMP_WORDS[COMP_CWORD]}"
  prev="\${COMP_WORDS[COMP_CWORD-1]}"

  commands="${commands.join(" ")}"

  if [[ \${COMP_CWORD} -eq 1 ]]; then
    COMPREPLY=( $(compgen -W "\${commands}" -- "\${cur}") )
    return 0
  fi

  # Global options
  local global_opts="--output --project --org --confirm --color --debug --help --version"
  COMPREPLY=( $(compgen -W "\${global_opts}" -- "\${cur}") )
}

complete -F _wave_completions wave`;
}

function generateZshCompletion(program: Command): string {
  const commands = getCommandNames(program);
  const cmdList = commands
    .map((name) => {
      const cmd = program.commands.find((c) => c.name() === name);
      const desc = cmd?.description() ?? name;
      return `    '${name}:${desc.replace(/'/g, "'\\''")}'`;
    })
    .join("\n");

  return `#compdef wave
# WAVE CLI zsh completion
# Add to ~/.zshrc: eval "$(wave completion zsh)"

_wave() {
  local -a commands
  commands=(
${cmdList}
  )

  _arguments -C \\
    '--output[Output format]:format:(table json yaml)' \\
    '--project[Project name]:project:' \\
    '--org[Organization]:org:' \\
    '--debug[Enable debug output]' \\
    '--help[Show help]' \\
    '--version[Show version]' \\
    '1:command:->command' \\
    '*::arg:->args'

  case $state in
    command)
      _describe 'command' commands
      ;;
  esac
}

_wave`;
}

function generateFishCompletion(program: Command): string {
  const commands = getCommandNames(program);
  const completions = commands
    .map((name) => {
      const cmd = program.commands.find((c) => c.name() === name);
      const desc = cmd?.description() ?? name;
      return `complete -c wave -n '__fish_use_subcommand' -a '${name}' -d '${desc.replace(/'/g, "\\'")}'`;
    })
    .join("\n");

  return `# WAVE CLI fish completion
# Add to ~/.config/fish/completions/wave.fish: wave completion fish | source

# Disable file completions for wave
complete -c wave -f

# Global options
complete -c wave -l output -d 'Output format' -a 'table json yaml'
complete -c wave -l project -d 'Project name'
complete -c wave -l org -d 'Organization'
complete -c wave -l debug -d 'Enable debug output'
complete -c wave -l help -d 'Show help'
complete -c wave -l version -d 'Show version'

# Commands
${completions}`;
}
