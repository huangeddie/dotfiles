-- Options are automatically loaded before lazy.nvim startup
-- Default options that are always set: https://github.com/LazyVim/LazyVim/blob/main/lua/lazyvim/config/options.lua
-- Add any additional options here

vim.opt.wildignore:append("*.orig")
vim.opt.relativenumber = false

if vim.env.SSH_TTY or vim.env.SSH_CLIENT or vim.env.SSH_CONNECTION or vim.env.TMUX or vim.env.HERDR_ENV then
  vim.g.clipboard = {
    name = "OSC 52",
    copy = {
      ["+"] = require("vim.ui.clipboard.osc52").copy("+"),
      ["*"] = require("vim.ui.clipboard.osc52").copy("*"),
    },
    paste = {
      ["+"] = require("vim.ui.clipboard.osc52").paste("+"),
      ["*"] = require("vim.ui.clipboard.osc52").paste("*"),
    },
  }
end

vim.filetype.add({
  extension = {
    pi = "python",
  },
})
