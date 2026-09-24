# Writes validation/reference/msstatsptm.json: MSstatsPTM's adjustment of site-level changes for
# the changes of their proteins (.adjustProteinLevel: log2FC difference, standard errors added in
# quadrature, Welch-Satterthwaite df), which adjustForProtein in web/lib/stats.js must reproduce.
#
#   Rscript validation/scripts/msstatsptm-reference.R validation/reference/msstatsptm.json [utils_groupComparison.R]
#
# Uses the installed MSstatsPTM package, or, when given, the file R/utils_groupComparison.R of its
# source. Needs data.table and jsonlite; none of these are part of Proteoscope.
suppressMessages(library(data.table))
library(jsonlite)
args <- commandArgs(trailingOnly = TRUE)
if (length(args) > 1) {
  eval(parse(text = readLines(args[2])))
  adjust <- .adjustProteinLevel
  description <- file.path(dirname(dirname(args[2])), "DESCRIPTION")
  release <- if (file.exists(description)) read.dcf(description, "Version")[1] else "(unknown version)"
  version <- paste("MSstatsPTM", release, "(R/utils_groupComparison.R from its source)")
} else {
  suppressMessages(library(MSstatsPTM))
  adjust <- MSstatsPTM:::.adjustProteinLevel
  version <- paste("MSstatsPTM", packageVersion("MSstatsPTM"))
}

set.seed(11)
n <- 60
site <- data.table(Protein = paste0("P", seq_len(n)), Site = paste0("P", seq_len(n), "_S", seq_len(n)), Label = "B-A",
                   log2FC = rnorm(n, 0, 1.5), SE = runif(n, 0.05, 0.8), DF = sample(c(2:12, 4.7, 7.3, 15.2, 30, 1e4), n, TRUE))
protein <- data.table(Protein = paste0("P", seq_len(n)), Label = "B-A",
                      log2FC = rnorm(n, 0, 1), SE = runif(n, 0.02, 0.5), DF = sample(c(3:20, 5.5, 9.9, 40, 250, Inf), n, TRUE))
# Edge cases: a site without its protein, infinite site changes (a group entirely missing), and a
# protein with SE 0.
protein <- protein[Protein != "P5"]
site[6, log2FC := Inf]
site[7, log2FC := -Inf]
protein[Protein == "P8", SE := 0]
adjusted <- adjust(site, protein)
adjusted <- adjusted[match(site$Site, adjusted$Site)]
out <- list(source = version,
            site = list(protein = site$Protein, logFC = site$log2FC, se = site$SE, df = site$DF),
            protein = list(protein = protein$Protein, logFC = protein$log2FC, se = protein$SE, df = protein$DF),
            adjusted = list(site = adjusted$Site, logFC = adjusted$log2FC, se = adjusted$SE, df = adjusted$DF,
                            t = adjusted$Tvalue, p = adjusted$pvalue))
writeLines(toJSON(out, digits = I(15), na = "string", auto_unbox = TRUE), if (length(args)) args[1] else stdout())
