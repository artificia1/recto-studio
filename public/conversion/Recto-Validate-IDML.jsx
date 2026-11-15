// Run from Adobe InDesign's Scripts panel. Opens only temporary document instances.
(function () {
    var input = File.openDialog('Choose a Recto IDML export');
    if (!input) return;
    var inputName = decodeURIComponent(input.name);
    if (!/\.idml$/i.test(inputName)) {
        alert('Choose an .idml package exported from Recto.');
        return;
    }
    var parent = Folder.selectDialog('Choose where to save the round-trip report and native IDML');
    if (!parent) return;
    var output = new Folder(parent.fsName + '/Recto-IDML-check-' + new Date().getTime());
    if (output.exists || !output.create()) {
        alert('Could not create a separate results folder.');
        return;
    }
    var roundTrip = new File(output.fsName + '/indesign-roundtrip.idml');
    var report = new File(output.fsName + '/roundtrip-report.txt');
    var results = new File(output.fsName + '/roundtrip-report.json');
    var preferences = app.scriptPreferences;
    var previousInteraction = preferences.userInteractionLevel;
    var previousUnits = preferences.measurementUnit;
    var first = null, second = null;
    var openIds = {};
    for (var i = 0; i < app.documents.length; i++) openIds[app.documents[i].id] = true;
    var lines = ['Recto IDML handoff check', 'InDesign version ' + app.version, 'Source ' + inputName, ''];
    var status = 'ERROR';
    var reportWritten = false;
    var resultsWritten = false;
    var checks = [];
    var review = { missingFonts: [], links: [], oversetOpened: 0, oversetReopened: 0 };
    var failure = '';

    function openFresh(file) {
        var opened = app.open(file, false);
        if (openIds[opened.id]) throw new Error('The chosen document is already open. Close it yourself and run the check again.');
        return opened;
    }

    function number(value) {
        var parsed = Number(value);
        return isFinite(parsed) ? parsed.toFixed(3) : String(value);
    }

    function dimensions(bounds) {
        var parts = [];
        for (var i = 0; i < bounds.length; i++) parts.push(number(bounds[i]));
        return parts.join(' ');
    }

    function names(collection) {
        var result = [];
        for (var i = 0; i < collection.length; i++) result.push(String(collection[i].name));
        return result.sort();
    }

    function snapshot(document) {
        var result = {
            pages: [], spreads: [], parents: [], layers: [], stories: [], artwork: [],
            paragraphStyles: names(document.allParagraphStyles), characterStyles: names(document.allCharacterStyles),
            swatches: names(document.swatches), missingFonts: [], linksNeedingReview: [], overset: 0
        };
        var i, page, layer, story, item;
        for (i = 0; i < document.pages.length; i++) {
            page = document.pages[i];
            var parentName = page.appliedMaster && page.appliedMaster.isValid ? page.appliedMaster.name : '';
            result.pages.push(page.name + ' | ' + dimensions(page.bounds) + ' | ' + parentName);
        }
        for (i = 0; i < document.spreads.length; i++) result.spreads.push(String(document.spreads[i].pages.length));
        for (i = 0; i < document.masterSpreads.length; i++) {
            var master = document.masterSpreads[i];
            var base = master.appliedMaster && master.appliedMaster.isValid ? master.appliedMaster.name : '';
            result.parents.push(master.name + ' | ' + master.pages.length + ' | ' + base);
        }
        for (i = 0; i < document.layers.length; i++) {
            layer = document.layers[i];
            result.layers.push(layer.name + ' | ' + layer.visible + ' | ' + layer.locked + ' | ' + layer.printable);
        }
        for (i = 0; i < document.stories.length; i++) {
            story = document.stories[i];
            result.stories.push(story.textContainers.length + ' | ' + story.overflows + ' | ' + String(story.contents));
            if (story.overflows) result.overset++;
        }
        var items = document.allPageItems;
        for (i = 0; i < items.length; i++) {
            item = items[i];
            var owner = item.parentPage && item.parentPage.isValid ? item.parentPage.name : '';
            result.artwork.push(item.constructor.name + ' | ' + owner + ' | ' + item.itemLayer.name + ' | ' +
                dimensions(item.geometricBounds) + ' | ' + item.nonprinting);
        }
        for (i = 0; i < document.fonts.length; i++) {
            if (document.fonts[i].status !== FontStatus.INSTALLED) result.missingFonts.push(String(document.fonts[i].name));
        }
        for (i = 0; i < document.links.length; i++) {
            var link = document.links[i];
            if (link.status !== LinkStatus.NORMAL && link.status !== LinkStatus.LINK_EMBEDDED) result.linksNeedingReview.push(String(link.name));
        }
        // IDs and traversal order can change when InDesign reserializes an equivalent document.
        result.stories.sort();
        result.artwork.sort();
        return result;
    }

    function equalLists(a, b) {
        if (a.length !== b.length) return false;
        for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
        return true;
    }

    function encode(value) {
        if (typeof value === 'string') {
            return '"' + value.replace(/[\x00-\x1f\\"]/g, function (character) {
                if (character === '"' || character === '\\') return '\\' + character;
                return '\\u00' + ('0' + character.charCodeAt(0).toString(16)).slice(-2);
            }) + '"';
        }
        if (typeof value === 'boolean' || typeof value === 'number') return String(value);
        var parts = [], key;
        if (value instanceof Array) {
            for (var i = 0; i < value.length; i++) parts.push(encode(value[i]));
            return '[' + parts.join(',') + ']';
        }
        for (key in value) if (Object.prototype.hasOwnProperty.call(value, key)) parts.push(encode(key) + ':' + encode(value[key]));
        return '{' + parts.join(',') + '}';
    }

    function write(file, text) {
        file.encoding = 'UTF-8';
        if (!file.open('w')) return false;
        try { return file.write(text); }
        finally { file.close(); }
    }

    function closeTemporary(document) {
        if (document && document.isValid) {
            try { document.close(SaveOptions.NO); }
            catch (error) {
                failure = 'Could not close a temporary document. ' + error.message;
                lines.push(failure);
                status = 'ERROR';
            }
        }
    }

    try {
        preferences.userInteractionLevel = UserInteractionLevels.NEVER_INTERACT;
        preferences.measurementUnit = MeasurementUnits.POINTS;
        first = openFresh(input);
        var before = snapshot(first);
        first.exportFile(ExportFormat.INDESIGN_MARKUP, roundTrip, false);
        second = openFresh(roundTrip);
        var after = snapshot(second);
        status = 'PASS';
        var groups = ['pages', 'spreads', 'parents', 'layers', 'stories', 'artwork', 'paragraphStyles', 'characterStyles', 'swatches'];
        for (var j = 0; j < groups.length; j++) {
            var group = groups[j], matches = equalLists(before[group], after[group]);
            if (!matches) status = 'REVIEW';
            checks.push({ group: group, matches: matches, opened: before[group].length, reopened: after[group].length });
            lines.push((matches ? 'PASS ' : 'REVIEW ') + group + ' (' + before[group].length + ' opened, ' + after[group].length + ' reopened)');
        }
        review = { missingFonts: before.missingFonts.concat(after.missingFonts), links: before.linksNeedingReview.concat(after.linksNeedingReview),
            oversetOpened: before.overset, oversetReopened: after.overset };
        if (review.missingFonts.length) { status = 'REVIEW'; lines.push('Missing or substituted fonts: ' + review.missingFonts.join(', ')); }
        if (review.links.length) { status = 'REVIEW'; lines.push('Links needing review: ' + review.links.join(', ')); }
        if (before.overset || after.overset) { status = 'REVIEW'; lines.push('Overset stories: ' + before.overset + ' opened, ' + after.overset + ' reopened.'); }
        lines.push('', 'This checks InDesign open, native IDML re-export, and the listed structural comparisons. Compare rendered pages for final production approval.');
    } catch (error) {
        failure = String(error.message);
        lines.push('ERROR ' + failure);
    } finally {
        closeTemporary(second);
        closeTemporary(first);
        preferences.measurementUnit = previousUnits;
        preferences.userInteractionLevel = previousInteraction;
        reportWritten = write(report, status + '\n\n' + lines.join('\n') + '\n');
        resultsWritten = write(results, encode({ version: 1, application: 'Adobe InDesign', applicationVersion: String(app.version),
            status: status, source: inputName, sourceBytes: input.length, roundTrip: 'indesign-roundtrip.idml',
            checks: checks, review: review, error: failure }) + '\n');
    }
    alert(status + '\n' + (reportWritten && resultsWritten ? report.fsName : 'Could not write both reports. Results folder ' + output.fsName));
}());
