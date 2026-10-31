// Run in Adobe InDesign's Scripts panel with the source document open.
// Exports a separate IDML file. Never saves or closes the source document.
(function () {
    if (app.documents.length === 0) {
        alert('Open your INDD document in InDesign, then run this script again.');
        return;
    }
    var document = app.activeDocument;
    var destination = File.saveDialog('Export IDML for Recto Studio', '*.idml');
    if (!destination) return;
    if (!/\.idml$/i.test(destination.name)) destination = new File(destination.fsName + '.idml');
    if (destination.exists && !confirm('Replace this IDML file?\n' + destination.fsName)) return;
    try {
        document.exportFile(ExportFormat.INDESIGN_MARKUP, destination, false);
        alert('IDML exported. Open the .idml file in Recto Studio.\n\nKeep your linked images and fonts available; unsupported features may need review.');
    } catch (error) {
        alert('Could not export IDML: ' + error.message + '\nThe source document has not been saved or closed.');
    }
}());
