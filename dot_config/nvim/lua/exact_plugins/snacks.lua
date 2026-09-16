return {
	"folke/snacks.nvim",
	opts = function(_, opts)
		opts.image = opts.image or {}

		-- Workaround for multiplexers (e.g. Herdr) where TIOCGWINSZ reports 0x0 pixel size
		local terminal = require("snacks.image.terminal")
		local orig_size = terminal.size
		terminal.size = function()
			local s = orig_size()
			if not s or s.cell_width == 0 or s.cell_height == 0 or s.cell_width ~= s.cell_width then
				local dw, dh = 9, 18
				return {
					width = vim.o.columns * dw,
					height = vim.o.lines * dh,
					columns = vim.o.columns,
					rows = vim.o.lines,
					cell_width = dw,
					cell_height = dh,
					scale = 1,
				}
			end
			return s
		end

		-- Clear lingering loading indicator extmark when placement updates
		local placement = require("snacks.image.placement")
		local orig_update = placement.update
		placement.update = function(self)
			if not self.opts.inline and vim.api.nvim_buf_is_valid(self.buf) then
				vim.api.nvim_buf_clear_namespace(self.buf, placement.ns, 0, -1)
			end
			return orig_update(self)
		end
	end,
}
