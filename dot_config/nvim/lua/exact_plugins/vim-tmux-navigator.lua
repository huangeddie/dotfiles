return {
  "christoomey/vim-tmux-navigator",
  cmd = {
    "TmuxNavigateLeft",
    "TmuxNavigateDown",
    "TmuxNavigateUp",
    "TmuxNavigateRight",
    "TmuxNavigatePrevious",
    "TmuxNavigatorProcessList",
  },
  keys = {
    { "<c-h>",  "<cmd>TmuxNavigateLeft<cr>", mode = { "n", "x" } },
    { "<c-j>",  "<cmd>TmuxNavigateDown<cr>", mode = { "n", "x" } },
    { "<c-k>",  "<cmd>TmuxNavigateUp<cr>", mode = { "n", "x" } },
    { "<c-l>",  "<cmd>TmuxNavigateRight<cr>", mode = { "n", "x" } },
    { "<c-\\>", "<cmd>TmuxNavigatePrevious<cr>", mode = { "n", "x" } },
  },
}
