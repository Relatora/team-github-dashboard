/**
 * PDF export, replacing Kendo's PDFExport and drawDOM.
 *
 * html2canvas-pro rather than html2canvas: Tailwind v4 emits oklch() colours
 * and the original parser throws on them, so the export fails outright on a
 * modern Tailwind build. The fork understands the modern colour syntax.
 *
 * Both libraries are imported dynamically. Together they are large, and a user
 * who never exports should not pay for them on first load.
 */
export async function exportPdf(element: HTMLElement, fileName: string): Promise<void> {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
    import("html2canvas-pro"),
    import("jspdf"),
  ]);

  const canvas = await html2canvas(element, {
    // Two device pixels per CSS pixel. One renders visibly soft text at print
    // size; three quadruples the memory for no visible gain.
    scale: 2,
    useCORS: true,
    // The element is positioned off screen, so the capture has to be told to
    // start at its own origin rather than the window's scroll position.
    scrollX: 0,
    scrollY: 0,
    backgroundColor: getComputedStyle(document.body).backgroundColor || "#ffffff",
    logging: false,
  });

  const pdf = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = 24;

  const usableWidth = pageWidth - margin * 2;
  const scale = usableWidth / canvas.width;
  const scaledHeight = canvas.height * scale;

  // How much of the source canvas fits on one page.
  const pageCanvasHeight = Math.floor((pageHeight - margin * 2) / scale);

  const image = document.createElement("canvas");
  const context = image.getContext("2d");
  if (!context) throw new Error("Could not get a 2D drawing context.");

  if (scaledHeight <= pageHeight - margin * 2) {
    pdf.addImage(canvas.toDataURL("image/png"), "PNG", margin, margin, usableWidth, scaledHeight);
  } else {
    // Slice the tall capture into page-sized strips. Doing this rather than
    // scaling everything onto one page is what keeps the report readable: a
    // multi-page report squeezed onto a single sheet is unreadable at any size.
    let offset = 0;
    let first = true;

    while (offset < canvas.height) {
      const sliceHeight = Math.min(pageCanvasHeight, canvas.height - offset);
      image.width = canvas.width;
      image.height = sliceHeight;
      context.clearRect(0, 0, image.width, image.height);
      context.drawImage(canvas, 0, offset, canvas.width, sliceHeight, 0, 0, canvas.width, sliceHeight);

      if (!first) pdf.addPage();
      pdf.addImage(
        image.toDataURL("image/png"),
        "PNG",
        margin,
        margin,
        usableWidth,
        sliceHeight * scale
      );

      offset += sliceHeight;
      first = false;
    }
  }

  pdf.save(fileName);
}
