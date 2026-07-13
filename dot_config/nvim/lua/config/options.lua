-- Options are automatically loaded before lazy.nvim startup
-- Default options that are always set: https://github.com/LazyVim/LazyVim/blob/main/lua/lazyvim/config/options.lua
-- Add any additional options here

vim.opt.wildignore:append("*.orig")
vim.opt.relativenumber = false

if vim.env.SSH_TTY or vim.env.SSH_CLIENT or vim.env.SSH_CONNECTION or vim.env.TMUX or vim.env.HERDR_ENV then
  -- Reading the clipboard via OSC 52 requires the terminal to answer a
  -- clipboard-read query, which most terminals refuse for security. Waiting on
  -- that reply blocks every paste ("Waiting for OSC 52 response..."). Use OSC 52
  -- for copy only, and paste from Neovim's own last-yank register instead.
  local function paste_from_register()
    return {
      vim.fn.split(vim.fn.getreg(""), "\n"),
      vim.fn.getregtype(""),
    }
  end
  vim.g.clipboard = {
    name = "OSC 52",
    copy = {
      ["+"] = require("vim.ui.clipboard.osc52").copy("+"),
      ["*"] = require("vim.ui.clipboard.osc52").copy("*"),
    },
    paste = {
      ["+"] = paste_from_register,
      ["*"] = paste_from_register,
    },
  }
end

vim.filetype.add({
  extension = {
    pi = "python",
  },
})
