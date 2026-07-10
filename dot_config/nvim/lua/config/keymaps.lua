-- Keymaps are automatically loaded on the VeryLazy event
-- Default keymaps that are always set: https://github.com/LazyVim/LazyVim/blob/main/lua/lazyvim/config/keymaps.lua
-- Add any additional keymaps here

local function copy_to_os_clipboard(text)
  -- 1. Always set the internal registers.
  vim.fn.setreg("+", text)
  vim.fn.setreg("*", text)

  -- 2. Use OSC 52 for SSH or Tmux sessions (copies to your local machine's clipboard).
  -- This is fast and won't hang like xclip/wl-copy can over SSH.
  if vim.env.SSH_TTY or vim.env.TMUX or vim.env.SSH_CONNECTION or vim.env.HERDR_ENV then
    local ok, osc52 = pcall(require, "vim.ui.clipboard.osc52")
    if ok and osc52 then
      osc52.copy("*")({ text })
      osc52.copy("+")({ text })
    end
  end
end


vim.api.nvim_create_autocmd("FileType", {
  pattern = "markdown",
  callback = function()
    pcall(vim.keymap.del, "n", "<leader>cp", { buffer = 0 })
  end,
})

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
