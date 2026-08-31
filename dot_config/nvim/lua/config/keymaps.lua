-- Keymaps are automatically loaded on the VeryLazy event
-- Default keymaps that are always set: https://github.com/LazyVim/LazyVim/blob/main/lua/lazyvim/config/keymaps.lua
-- Add any additional keymaps here

local path_util = require("util.path")

-- Path copying keymaps (<leader>y...)
vim.keymap.set({ "n", "x" }, "<leader>yp", function()
  path_util.copy_path()
end, { desc = "Copy relative path" })

vim.keymap.set({ "n", "x" }, "<leader>ya", function()
  path_util.copy_path({ annotated = true })
end, { desc = "Copy annotated path (@)" })

vim.keymap.set("n", "<leader>yd", function()
  path_util.copy_path({ dir_only = true })
end, { desc = "Copy directory path" })

vim.keymap.set("n", "<leader>yD", function()
  path_util.copy_path({ dir_only = true, annotated = true })
end, { desc = "Copy annotated directory path (@)" })

vim.keymap.set("n", "<leader>yA", function()
  path_util.copy_path({ all_buffers = true, annotated = true })
end, { desc = "Copy all open buffer paths (@)" })
