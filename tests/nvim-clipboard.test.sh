#!/usr/bin/env bash
set -euo pipefail

repo_dir=$(cd "$(dirname "$0")/.." && pwd)
nvim -l - "$repo_dir" <<'LUA'
local root = arg[1]
vim.opt.rtp:prepend(root .. "/dot_config/nvim")
package.path = root .. "/dot_config/nvim/lua/?.lua;" .. package.path

-- Replace the terminal effect, not Neovim's register/provider integration.
local copies = {}
package.loaded["vim.ui.clipboard.osc52"] = {
  copy = function(register)
    return function(lines)
      copies[#copies + 1] = { register = register, lines = lines }
    end
  end,
}

local remote_markers = { "SSH_TTY", "SSH_CLIENT", "SSH_CONNECTION", "TMUX", "HERDR_ENV", "REX_SESSION" }
for _, marker in ipairs(remote_markers) do
  vim.env[marker] = nil
end

dofile(root .. "/dot_config/nvim/lua/config/options.lua")
assert(vim.g.clipboard == nil, "local sessions must retain automatic clipboard selection")

-- Test each remote marker independently, including Rex without SSH variables.
for _, marker in ipairs(remote_markers) do
  vim.env[marker] = "1"
  dofile(root .. "/dot_config/nvim/lua/config/options.lua")
  assert(vim.g.clipboard.name == "OSC 52", marker .. " must select OSC 52")
  copies = {}
  require("util.path").copy_to_os_clipboard("folder/file name.lua")
  assert(#copies == 2, marker .. ": expected one copy per register, got " .. #copies)
  assert(copies[1].register == "+" and copies[2].register == "*", "both clipboard registers must be copied")
  for _, copy in ipairs(copies) do
    assert(vim.deep_equal(copy.lines, { "folder/file name.lua" }), "path text must be preserved")
  end
  vim.env[marker] = nil
end
print("PASS: local clipboard selection and remote path copies without duplicate writes")
LUA
