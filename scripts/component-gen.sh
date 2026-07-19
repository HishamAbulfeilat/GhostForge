#!/usr/bin/env bash
set -euo pipefail
RED='\033[0;31m' GREEN='\033[0;32m' YELLOW='\033[1;33m' CYAN='\033[0;36m' NC='\033[0m' BOLD='\033[1m' DIM='\033[2m'

ACTION="${1:-help}"
shift || true

header() {
  echo ""
  echo -e "${CYAN}${BOLD}  🏗️  GhostForge Component Generator${NC}"
  echo -e "${DIM}  Generate typed React components with tests, stories, and barrel exports.${NC}"
  echo ""
}

select_type() {
  local provided="${1:-}"
  if [[ -n "$provided" ]]; then
    printf '%s\n' "$provided"
    return 0
  fi

  PS3="Choose component type: "
  local options=("UI Component" "Form Component" "Layout Component" "Page Component")
  select opt in "${options[@]}"; do
    case "$opt" in
      "UI Component") printf 'ui\n'; return 0 ;;
      "Form Component") printf 'form\n'; return 0 ;;
      "Layout Component") printf 'layout\n'; return 0 ;;
      "Page Component") printf 'page\n'; return 0 ;;
      *) echo -e "${YELLOW}Choose 1-4.${NC}" ;;
    esac
  done
}

append_parent_export() {
  local component_name="$1"
  local component_dir="$2"
  local current
  current="$(dirname "$component_dir")"

  while [[ "$current" != "." && "$current" != "/" ]]; do
    local parent_index="$current/index.ts"
    if [[ -f "$parent_index" ]]; then
      local rel_path="${component_dir#${current}/}"
      local export_line="export { default as ${component_name} } from './${rel_path}/${component_name}';"
      if ! grep -Fq "$export_line" "$parent_index"; then
        printf '\n%s\n' "$export_line" >> "$parent_index"
      fi
      return 0
    fi
    local next
    next="$(dirname "$current")"
    [[ "$next" == "$current" ]] && break
    current="$next"
  done
}

create_component() {
  local name="${1:-}"
  local target_dir="${2:-}"
  local kind="${3:-}"
  [[ -n "$name" ]] || {
    echo -e "${RED}✖ Component name is required.${NC}"
    exit 1
  }
  [[ "$name" =~ ^[A-Z][A-Za-z0-9]+$ ]] || {
    echo -e "${RED}✖ Use PascalCase, e.g. ButtonGroup.${NC}"
    exit 1
  }

  kind="$(select_type "$kind")"
  target_dir="${target_dir:-src/components/${name}}"
  mkdir -p "$target_dir"

  COMPONENT_NAME="$name" COMPONENT_DIR="$target_dir" COMPONENT_KIND="$kind" python3 - <<'PY'
from pathlib import Path
import os

name = os.environ["COMPONENT_NAME"]
out_dir = Path(os.environ["COMPONENT_DIR"])
kind = os.environ["COMPONENT_KIND"]

def write(path, content):
    path.write_text(content.rstrip() + "\n", encoding="utf-8")

if kind == "form":
    component = f"""import {{ forwardRef }} from 'react';

export interface {name}Props extends React.InputHTMLAttributes<HTMLInputElement> {{
  label?: string;
  helperText?: string;
  error?: string;
}}

const {name} = forwardRef<HTMLInputElement, {name}Props>(function {name}({{ label, helperText, error, className = '', id, ...props }}, ref) {{
  const fieldId = id ?? '{name[0].lower() + name[1:]}';

  return (
    <div className={{['flex flex-col gap-2', className].filter(Boolean).join(' ')}}>
      {{label ? <label htmlFor={{fieldId}} className="text-sm font-medium text-slate-700">{{label}}</label> : null}}
      <input
        ref={{ref}}
        id={{fieldId}}
        className="rounded-lg border border-slate-300 px-3 py-2 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-200"
        aria-invalid={{error ? 'true' : 'false'}}
        {{...props}}
      />
      {{error ? <p className="text-sm text-red-600">{{error}}</p> : helperText ? <p className="text-sm text-slate-500">{{helperText}}</p> : null}}
    </div>
  );
}});

export default {name};
"""
    test = f"""import {{ fireEvent, render, screen }} from '@testing-library/react';
import {{ describe, expect, it }} from 'vitest';

import {name} from './{name}';

describe('{name}', () => {{
  it('renders the label', () => {{
    render(<{name} label="Email" placeholder="name@example.com" />);
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
  }});

  it('supports typing', () => {{
    render(<{name} label="Email" />);
    const input = screen.getByLabelText('Email');
    fireEvent.change(input, {{ target: {{ value: 'ghostforge@ghostforge.sa' }} }});
    expect((input as HTMLInputElement).value).toBe('ghostforge@ghostforge.sa');
  }});

  it('matches the snapshot', () => {{
    const {{ asFragment }} = render(<{name} label="Email" helperText="Required field" />);
    expect(asFragment()).toMatchSnapshot();
  }});
}});
"""
    story = f"""import type {{ Meta, StoryObj }} from '@storybook/react';

import {name} from './{name}';

const meta = {{
  title: 'Components/{name}',
  component: {name},
  args: {{
    label: 'Email',
    placeholder: 'name@example.com',
    helperText: 'We will never share your email.',
  }},
}} satisfies Meta<typeof {name}>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {{}};
export const Playground: Story = {{ args: {{ label: 'Work email', helperText: 'Use your company domain' }} }};
"""
elif kind == "layout":
    component = f"""import type {{ HTMLAttributes, ReactNode }} from 'react';

export interface {name}Props extends HTMLAttributes<HTMLDivElement> {{
  title?: string;
  aside?: ReactNode;
  children?: ReactNode;
}}

export default function {name}({{ title, aside, children, className = '', ...props }}: {name}Props) {{
  return (
    <section className={{['grid gap-6 lg:grid-cols-[1fr_320px]', className].filter(Boolean).join(' ')}} {{...props}}>
      <div className="space-y-4">
        {{title ? <h2 className="text-2xl font-semibold text-slate-900">{{title}}</h2> : null}}
        <div>{{children}}</div>
      </div>
      {{aside ? <aside className="rounded-2xl border border-slate-200 p-4">{{aside}}</aside> : null}}
    </section>
  );
}}
"""
    test = f"""import {{ render, screen }} from '@testing-library/react';
import {{ describe, expect, it }} from 'vitest';

import {name} from './{name}';

describe('{name}', () => {{
  it('renders title and content', () => {{
    render(<{name} title="Overview">Body</{name}>);
    expect(screen.getByText('Overview')).toBeInTheDocument();
    expect(screen.getByText('Body')).toBeInTheDocument();
  }});

  it('matches the snapshot', () => {{
    const {{ asFragment }} = render(<{name} title="Overview" aside={{<span>Filters</span>}}>Body</{name}>);
    expect(asFragment()).toMatchSnapshot();
  }});
}});
"""
    story = f"""import type {{ Meta, StoryObj }} from '@storybook/react';

import {name} from './{name}';

const meta = {{
  title: 'Layouts/{name}',
  component: {name},
  args: {{
    title: 'Analytics Overview',
    children: <div className="rounded-xl bg-slate-100 p-6">Main content area</div>,
    aside: <div className="text-sm text-slate-600">Context panel</div>,
  }},
}} satisfies Meta<typeof {name}>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {{}};
export const Playground: Story = {{ args: {{ title: 'Operations Dashboard' }} }};
"""
elif kind == "page":
    component = f"""import type {{ ReactNode }} from 'react';

export interface {name}Props {{
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children?: ReactNode;
}}

export default function {name}({{ title, subtitle, actions, children }}: {name}Props) {{
  return (
    <main className="space-y-8 p-6">
      <header className="flex flex-col gap-4 border-b border-slate-200 pb-6 md:flex-row md:items-end md:justify-between">
        <div className="space-y-2">
          <p className="text-sm uppercase tracking-[0.2em] text-sky-600">GhostForge Page</p>
          <h1 className="text-3xl font-semibold text-slate-950">{{title}}</h1>
          {{subtitle ? <p className="max-w-2xl text-slate-600">{{subtitle}}</p> : null}}
        </div>
        {{actions ? <div>{{actions}}</div> : null}}
      </header>
      <section>{{children}}</section>
    </main>
  );
}}
"""
    test = f"""import {{ render, screen }} from '@testing-library/react';
import {{ describe, expect, it }} from 'vitest';

import {name} from './{name}';

describe('{name}', () => {{
  it('renders heading content', () => {{
    render(<{name} title="Control Center" subtitle="Live deployment overview" />);
    expect(screen.getByRole('heading', {{ name: 'Control Center' }})).toBeInTheDocument();
    expect(screen.getByText('Live deployment overview')).toBeInTheDocument();
  }});

  it('matches the snapshot', () => {{
    const {{ asFragment }} = render(<{name} title="Control Center">Dashboard widgets</{name}>);
    expect(asFragment()).toMatchSnapshot();
  }});
}});
"""
    story = f"""import type {{ Meta, StoryObj }} from '@storybook/react';

import {name} from './{name}';

const meta = {{
  title: 'Pages/{name}',
  component: {name},
  args: {{
    title: 'GhostForge Command Center',
    subtitle: 'Monitor releases, coverage, accessibility, and environment drift in one place.',
    children: <div className="rounded-2xl bg-slate-100 p-8">Page content area</div>,
  }},
}} satisfies Meta<typeof {name}>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {{}};
export const Playground: Story = {{ args: {{ title: 'Release Console' }} }};
"""
else:
    component = f"""import {{ forwardRef }} from 'react';

export interface {name}Props extends React.ButtonHTMLAttributes<HTMLButtonElement> {{
  label?: string;
}}

const {name} = forwardRef<HTMLButtonElement, {name}Props>(function {name}({{ label = '{name}', className = '', type = 'button', ...props }}, ref) {{
  return (
    <button
      ref={{ref}}
      type={{type}}
      className={{['inline-flex items-center justify-center rounded-xl bg-sky-600 px-4 py-2 font-medium text-white transition hover:bg-sky-700 focus:outline-none focus:ring-2 focus:ring-sky-300', className].filter(Boolean).join(' ')}}
      {{...props}}
    >
      {{label}}
    </button>
  );
}});

export default {name};
"""
    test = f"""import {{ fireEvent, render, screen }} from '@testing-library/react';
import {{ describe, expect, it, vi }} from 'vitest';

import {name} from './{name}';

describe('{name}', () => {{
  it('renders the component', () => {{
    render(<{name} label="Launch" />);
    expect(screen.getByRole('button', {{ name: 'Launch' }})).toBeInTheDocument();
  }});

  it('handles click interaction', () => {{
    const onClick = vi.fn();
    render(<{name} label="Launch" onClick={{onClick}} />);
    fireEvent.click(screen.getByRole('button', {{ name: 'Launch' }}));
    expect(onClick).toHaveBeenCalledTimes(1);
  }});

  it('matches the snapshot', () => {{
    const {{ asFragment }} = render(<{name} label="Launch" />);
    expect(asFragment()).toMatchSnapshot();
  }});
}});
"""
    story = f"""import type {{ Meta, StoryObj }} from '@storybook/react';

import {name} from './{name}';

const meta = {{
  title: 'Components/{name}',
  component: {name},
  args: {{
    label: '{name}',
  }},
}} satisfies Meta<typeof {name}>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {{}};
export const Playground: Story = {{ args: {{ label: 'Primary action' }} }};
"""

write(out_dir / f"{name}.tsx", component)
write(out_dir / f"{name}.test.tsx", test)
write(out_dir / f"{name}.stories.tsx", story)
write(out_dir / "index.ts", f"export {{ default }} from './{name}';\n")
PY

  append_parent_export "$name" "$target_dir"

  header
  echo -e "${GREEN}✅ Generated component bundle:${NC} $target_dir"
  echo -e "${CYAN}Type:${NC} $kind"
}

list_components() {
  local base="src/components"
  header
  if [[ ! -d "$base" ]]; then
    echo -e "${YELLOW}⚠ ${base} does not exist yet.${NC}"
    exit 0
  fi
  find "$base" -mindepth 1 -maxdepth 1 -type d | sort | while read -r dir; do
    local count
    count="$(find "$dir" -maxdepth 1 -type f | wc -l | tr -d ' ')"
    echo -e "${GREEN}•${NC} $(basename "$dir") ${DIM}(${count} files)${NC}"
  done
}

help_text() {
  header
  cat <<EOF
Usage:
  bash scripts/component-gen.sh create <ComponentName> [dir] [type]
  bash scripts/component-gen.sh list
  bash scripts/component-gen.sh help

Types:
  ui | form | layout | page
EOF
}

case "$ACTION" in
  create) create_component "${1:-}" "${2:-}" "${3:-}" ;;
  list) list_components ;;
  help|--help|-h) help_text ;;
  *) help_text; exit 1 ;;
esac
