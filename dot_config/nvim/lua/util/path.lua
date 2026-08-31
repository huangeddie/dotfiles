local M = {}

---@class CopyPathOptions
---@field annotated? boolean     -- Prefix with '@' (e.g. '@path/to/file')
---@field dir_only? boolean      -- Copy directory instead of file (e.g. 'path/to')
---@field link? boolean          -- Format as web/CodeSearch URL
---@field link_prefix? string    -- URL prefix (e.g. 'http://google3/')
---@field head_prefix? string    -- Head depot prefix (e.g. '/google/src/head/depot/google3/')
---@field all_buffers? boolean   -- Copy all listed open buffer paths
---@field root_resolver? fun(full_path: string): string? -- Custom root extractor

--- Extracts relative path relative to google3 or project root.
---@param full_path string
---@param project_root? string
---@param root_resolver? fun(full_path: string): string?
---@return string
function M.get_relative_path(full_path, project_root, root_resolver)
  if root_resolver then
    local resolved = root_resolver(full_path)
    if resolved then
      return resolved
    end
  end

  -- Default Google3 detection:
  local g3_start = full_path:find("/google3/")
  if g3_start then
    return full_path:sub(g3_start + 1)
  end

  -- Relative to project root
  if project_root and project_root ~= "" then
    local clean_root = project_root:gsub("/+$", "")
    if full_path:sub(1, #clean_root) == clean_root then
      local rel = full_path:sub(#clean_root + 1):gsub("^/+", "")
      if rel == "" then
        return "."
      end
      return rel
    end
  end

  if vim and vim.fn and vim.fn.fnamemodify then
    return vim.fn.fnamemodify(full_path, ":.")
  end

  return full_path
end

--- Formats the relative path based on given options and visual range.
---@param full_path string
---@param project_root? string
---@param opts? CopyPathOptions
---@param range? {start_line: integer, end_line: integer}
---@return string?
function M.format_path(full_path, project_root, opts, range)
  opts = opts or {}
  local rel = M.get_relative_path(full_path, project_root, opts.root_resolver)

  if opts.dir_only then
    if rel == "." or not rel:find("/") then
      rel = "."
    else
      rel = rel:match("^(.*)/[^/]*$") or "."
    end
  end

  if opts.link then
    if not opts.link_prefix or opts.link_prefix == "" then
      return nil
    end
    local target = rel
    if target:match("^google3/") then
      target = target:sub(9)
    end
    local url = opts.link_prefix .. target
    if range and not opts.dir_only then
      local s, e = range.start_line, range.end_line
      if s > e then
        s, e = e, s
      end
      if s == e then
        url = url .. "?l=" .. s
      else
        url = url .. "?l=" .. s .. "-" .. e
      end
    end
    return url
  end

  if opts.head_prefix then
    local target = rel
    if target:match("^google3/") then
      target = target:sub(9)
    end
    local head_path = opts.head_prefix .. target
    if range and not opts.dir_only then
      local s, e = range.start_line, range.end_line
      if s > e then
        s, e = e, s
      end
      if s == e then
        head_path = head_path .. ":" .. s
      else
        head_path = head_path .. ":" .. s .. "-" .. e
      end
    end
    return head_path
  end

  if range and not opts.dir_only then
    local s, e = range.start_line, range.end_line
    if s > e then
      s, e = e, s
    end
    if s == e then
      rel = rel .. ":" .. s
    else
      rel = rel .. ":" .. s .. "-" .. e
    end
  end

  if opts.annotated then
    rel = "@" .. rel
  end

  return rel
end

--- Formats all listed open buffer paths.
---@param bufs integer[]
---@param project_root? string
---@param opts? CopyPathOptions
---@return string
function M.format_all_buffers(bufs, project_root, opts)
  opts = opts or {}
  local paths = {}
  for _, buf in ipairs(bufs) do
    if vim.api.nvim_buf_is_valid(buf) and vim.bo[buf].buflisted then
      local name = vim.api.nvim_buf_get_name(buf)
      if name ~= "" then
        local formatted = M.format_path(name, project_root, opts)
        if formatted and formatted ~= "" then
          table.insert(paths, formatted)
        end
      end
    end
  end
  return table.concat(paths, " ")
end

--- Copy string to system clipboard with OSC 52 fallback.
---@param text string
function M.copy_to_os_clipboard(text)
  vim.fn.setreg("+", text)
  vim.fn.setreg("*", text)

  if vim.env.SSH_TTY or vim.env.TMUX or vim.env.SSH_CONNECTION or vim.env.HERDR_ENV then
    local ok, osc52 = pcall(require, "vim.ui.clipboard.osc52")
    if ok and osc52 then
      osc52.copy("*")({ text })
      osc52.copy("+")({ text })
    end
  end
end

--- Orchestrates buffer reading, line range extraction, formatting, and clipboard copy.
---@param opts? CopyPathOptions
function M.copy_path(opts)
  opts = opts or {}

  local root = (LazyVim and LazyVim.root and LazyVim.root()) or vim.fn.getcwd()

  if opts.all_buffers then
    local bufs = vim.api.nvim_list_bufs()
    local result = M.format_all_buffers(bufs, root, opts)
    if result ~= "" then
      M.copy_to_os_clipboard(result)
      vim.notify("Copied: " .. result, vim.log.levels.INFO)
    else
      vim.notify("No valid file buffers found.", vim.log.levels.WARN)
    end
    return
  end

  local full_path = vim.api.nvim_buf_get_name(0)
  if not full_path or full_path == "" then
    vim.notify("No file in current buffer", vim.log.levels.WARN)
    return
  end

  local range = nil
  local mode = vim.fn.mode()
  if mode == "v" or mode == "V" or mode == "\22" then
    local start_line = vim.fn.line("v")
    local end_line = vim.fn.line(".")
    range = { start_line = start_line, end_line = end_line }
    vim.api.nvim_feedkeys(vim.api.nvim_replace_termcodes("<Esc>", true, false, true), "n", true)
  end

  local result = M.format_path(full_path, root, opts, range)
  if not result then
    vim.notify("Path copy skipped (no provider available)", vim.log.levels.WARN)
    return
  end

  M.copy_to_os_clipboard(result)
  vim.notify("Copied: " .. result, vim.log.levels.INFO)
end

return M
