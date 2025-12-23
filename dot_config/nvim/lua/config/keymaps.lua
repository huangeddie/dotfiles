-- Keymaps are automatically loaded on the VeryLazy event
-- Default keymaps that are always set: https://github.com/LazyVim/LazyVim/blob/main/lua/lazyvim/config/keymaps.lua
-- Add any additional keymaps here

vim.keymap.set({ "n", "v" }, "<leader>cp", function()
  local path = "@" .. vim.fn.expand("%:.")
  local mode = vim.fn.mode()
  if mode == "v" or mode == "V" or mode == "\22" then
    local start_line = vim.fn.getpos("v")[2]
    local end_line = vim.fn.getpos(".")[2]
    if start_line > end_line then
      start_line, end_line = end_line, start_line
    end
    path = path .. ":" .. start_line .. "-" .. end_line
  end
  vim.fn.setreg("+", path)
  vim.notify("Copied: " .. path)
end, { desc = "Copy relative path" })

vim.keymap.set("n", "<leader>cP", function()
  local paths = {}
  for _, buf in ipairs(vim.api.nvim_list_bufs()) do
    if vim.api.nvim_buf_is_loaded(buf) and vim.bo[buf].buflisted then
      local name = vim.api.nvim_buf_get_name(buf)
      if name ~= "" then
        local rel = vim.fn.fnamemodify(name, ":.")
        table.insert(paths, "@" .. rel)
      end
    end
  end
  local result = table.concat(paths, " ")
  vim.fn.setreg("+", result)
  vim.notify("Copied: " .. result)
end, { desc = "Copy all buffer paths" })
