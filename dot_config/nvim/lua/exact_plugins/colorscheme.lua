return {
	{ "ellisonleao/gruvbox.nvim" },
	{ "kepano/flexoki-neovim" },
	{ "projekt0n/github-nvim-theme" },
	{
		"f-person/auto-dark-mode.nvim",
		event = "VeryLazy",
		opts = {
			set_dark_mode = function()
				vim.o.background = "dark"
				vim.cmd.colorscheme("github_dark")
			end,
			set_light_mode = function()
				vim.o.background = "light"
				vim.cmd.colorscheme("github_light")
			end,
		},
	},
}
