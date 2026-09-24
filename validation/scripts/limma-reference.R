# Writes validation/reference/limma.json: limma's moderated t-test (lmFit, contrasts.fit, eBayes)
# and Benjamini-Hochberg q-values for simulated log2 intensities, which moderatedTTest in
# web/lib/stats.js must reproduce.
#
#   Rscript validation/scripts/limma-reference.R validation/reference/limma.json
#
# Needs R with limma (Bioconductor) and jsonlite; neither is part of Proteoscope.
suppressMessages(library(limma))
library(jsonlite)

# log2 intensities: feature means ~ N(24, 2^2), residual SDs from a scaled inverse chi-square
# (d0 = 6, s0 = 0.25), 10% of the features changed by 1-3 log2 units, rounded to 3 decimals.
simulate <- function(n, nA, nB, seed, missing = FALSE) {
  set.seed(seed)
  mu <- rnorm(n, 24, 2)
  sd <- sqrt(6 * 0.25^2 / rchisq(n, 6))
  change <- rbinom(n, 1, 0.1) * sample(c(-1, 1), n, TRUE) * runif(n, 1, 3)
  groups <- c(rep("A", nA), rep("B", nB))
  x <- matrix(rnorm(n * (nA + nB)), n) * sd + mu
  x[, groups == "B"] <- x[, groups == "B"] + change
  # Intensity-dependent (MNAR) and random (MCAR) missing values.
  if (missing) x[matrix(runif(length(x)), n) < plogis(-(x - 21.5) * 1.5) + 0.05] <- NA
  list(x = round(x, 3), groups = groups)
}

# Residual variances less dispersed than chi-square (one residual pattern, scaled by 0.95-1.05):
# the moment estimate of the prior's excess variance is negative, so d0 is infinite.
lessDispersed <- function(n, seed) {
  set.seed(seed)
  pattern <- c(-1, 0.3, 0.7, -0.8, 1.1, -0.3)
  x <- outer(rnorm(n, 24, 2), rep(1, 6)) + outer(runif(n, 0.95, 1.05), pattern)
  x[, 4:6] <- x[, 4:6] + rbinom(n, 1, 0.1) * 2
  list(x = round(x, 3), groups = rep(c("A", "B"), each = 3))
}

# Features with at least minValid values in both groups are tested, as moderatedTTest does.
analyze <- function(description, data, minValid = 2) {
  x <- data$x
  groups <- data$groups
  valid <- function(group) rowSums(!is.na(x[, groups == group, drop = FALSE])) >= minValid
  tested <- which(valid("A") & valid("B"))
  g <- factor(groups, levels = c("A", "B"))
  design <- model.matrix(~ 0 + g)
  colnames(design) <- c("A", "B")
  fit <- lmFit(x[tested, , drop = FALSE], design)
  fit <- eBayes(contrasts.fit(fit, makeContrasts(B - A, levels = design)))
  column <- function(values) {
    out <- rep(NA_real_, nrow(x))
    out[tested] <- values
    out
  }
  list(description = description, groups = groups, minValid = minValid,
       d0 = if (is.finite(fit$df.prior)) fit$df.prior else "Inf", s02 = fit$s2.prior,
       x = x, logFC = column(fit$coefficients[, 1]), t = column(fit$t[, 1]),
       p = column(fit$p.value[, 1]), q = column(p.adjust(fit$p.value[, 1], "BH")))
}

cases <- list(
  analyze("3 vs 3, complete: equal residual df, moment estimate of the prior", simulate(300, 3, 3, 1)),
  analyze("4 vs 5 with missing values, at least 2 per group: unequal df, likelihood estimate", simulate(300, 4, 5, 4, missing = TRUE)),
  analyze("3 vs 3, residual variances less dispersed than chi-square: d0 infinite", lessDispersed(200, 5))
)
out <- list(source = paste("limma", packageVersion("limma"), "in", R.version.string), cases = cases)
args <- commandArgs(trailingOnly = TRUE)
writeLines(toJSON(out, digits = I(15), na = "null", auto_unbox = TRUE, matrix = "rowmajor"), if (length(args)) args[1] else stdout())
