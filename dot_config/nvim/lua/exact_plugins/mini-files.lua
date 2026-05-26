-- ~/.config/nvim/lua/plugins/mini-files.lua
--
-- mini.files with an in-explorer sort toggle:
--   gsn -> by name (default)
--   gsm -> by last modified (newest first)
--   gss -> by size (largest first)
--   gse -> by extension
return {
	"nvim-mini/mini.files",
	opts = {
		content = {
			filter = function(entry)
				-- hide files by extension
				if vim.endswith(entry.name, ".orig") then
					return false
				end

				-- Default filter: show everything else
				-- (LazyVim's default behavior is to show/hide dotfiles based on a toggle,
				-- so we typically want to return true here to let it pass)
				return true
			end,
		},
	},
	config = function(_, opts)
		local MiniFiles = require("mini.files")
		-- ---------- Sort functions ----------
		-- mini.files passes the whole entry list; we return it sorted.
		-- Each entry has: fs_type ("file"|"directory"), name, path.
		local sorts = {}
		sorts.name = MiniFiles.default_sort
		sorts.modified = function(fs_entries)
			local out = {}
			for _, e in ipairs(fs_entries) do
				local stat = vim.uv.fs_stat(e.path)
				table.insert(out, vim.tbl_extend("force", e, { mtime = stat and stat.mtime.sec or 0 }))
			end
			table.sort(out, function(a, b)
				if a.fs_type ~= b.fs_type then
					return a.fs_type == "directory"
				end
				return a.mtime > b.mtime
			end)
			return out
		end
		sorts.size = function(fs_entries)
			local out = {}
			for _, e in ipairs(fs_entries) do
				local stat = vim.uv.fs_stat(e.path)
				table.insert(out, vim.tbl_extend("force", e, { size = stat and stat.size or 0 }))
			end
			table.sort(out, function(a, b)
				if a.fs_type ~= b.fs_type then
					return a.fs_type == "directory"
				end
				return a.size > b.size
			end)
			return out
		end
		sorts.extension = function(fs_entries)
			local out = vim.deepcopy(fs_entries)
			table.sort(out, function(a, b)
				if a.fs_type ~= b.fs_type then
					return a.fs_type == "directory"
				end
				local a_ext = a.name:match("%.([^.]+)$") or ""
				local b_ext = b.name:match("%.([^.]+)$") or ""
				if a_ext ~= b_ext then
					return a_ext < b_ext
				end
				return a.name:lower() < b.name:lower()
			end)
			return out
		end
		MiniFiles.setup(opts)
		-- ---------- Toggle helper ----------
		local current_sort = "name"
		local function set_sort(name)
			if not sorts[name] then
				return
			end
			current_sort = name
			-- Passing `content` to refresh forces all directory buffers to re-read.
			-- Mutating MiniFiles.config.content.sort + bare refresh() won't re-sort.
			MiniFiles.refresh({ content = { sort = sorts[name] } })
			vim.notify("mini.files: sort by " .. name, vim.log.levels.INFO)
		end
		local set_cwd = function()
			local entry = MiniFiles.get_fs_entry()
			if entry == nil then
				return vim.notify("Cursor is not on valid entry")
			end
			local path = entry.path
			if entry.fs_type == "file" then
				path = vim.fs.dirname(path)
			end
			vim.fn.chdir(path)
			vim.notify("cwd set to " .. path)
		end
		local yank_relative_dir = function()
			local entry = MiniFiles.get_fs_entry()
			if entry == nil then
				return vim.notify("Cursor is not on valid entry")
			end
			local path = entry.path
			if entry.fs_type == "file" then
				path = vim.fs.dirname(path)
			end
			local rel = vim.fn.fnamemodify(path, ":.")
			vim.fn.setreg("+", rel)
			vim.fn.setreg('"', rel)
			vim.notify("yanked " .. rel)
		end

		-- ---------- Buffer-local mappings inside the explorer ----------
		vim.api.nvim_create_autocmd("User", {
			pattern = "MiniFilesBufferCreate",
			callback = function(args)
				local buf = args.data.buf_id
				local map = function(lhs, rhs, desc, opts)
					vim.keymap.set("n", lhs, rhs, vim.tbl_extend("force", { buffer = buf, desc = desc }, opts or {}))
				end
				map("gsn", function()
					set_sort("name")
				end, "Sort by name")
				map("gsm", function()
					set_sort("modified")
				end, "Sort by modified")
				map("gss", function()
					set_sort("size")
				end, "Sort by size")
				map("gse", function()
					set_sort("extension")
				end, "Sort by extension")
				map("g.", set_cwd, "Set cwd")
				map("gy", yank_relative_dir, "Yank dir path relative to cwd")

				pcall(function()
					require("lazy").load({ plugins = { "which-key.nvim" } })
				end)

				local ok, wk = pcall(require, "which-key")
				if ok then
					wk.add({
						{ "g", group = "mini.files", buffer = buf },
						{ "gs", group = "sort", buffer = buf },
						{ "gy", desc = "Yank dir path relative to cwd", buffer = buf },
					})

					local refresh_which_key = function()
						local ok_config, wk_config = pcall(require, "which-key.config")
						if not ok_config or not wk_config.loaded then
							return
						end

						local ok_buf, wk_buf = pcall(require, "which-key.buf")
						if ok_buf then
							wk_buf.get({ buf = buf, mode = "n", update = true })
						end
					end

					if vim.v.vim_did_enter == 1 then
						refresh_which_key()
					else
						vim.api.nvim_create_autocmd("VimEnter", {
							once = true,
							callback = refresh_which_key,
						})
					end
				end
			end,
		})
		-- Optional: expose current sort name for statusline etc.
		_G.MiniFilesCurrentSort = function()
			return current_sort
		end
	end,
}
