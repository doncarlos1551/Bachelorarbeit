$pdf_mode = 1;
$pdflatex = 'lualatex -interaction=nonstopmode -halt-on-error -synctex=1 %O %S';
$biber = 'biber --validate-datamodel %O %S';
$clean_ext = 'aux bbl bcf blg fdb_latexmk fls log out run.xml toc lof lot synctex.gz';
