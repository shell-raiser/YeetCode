(function() {
    try {
        let code = null;
        let languageId = null;

        if (window.monaco && window.monaco.editor) {
            const editors = typeof window.monaco.editor.getEditors === 'function'
                ? window.monaco.editor.getEditors()
                : [];

            if (editors.length > 0) {
                const editor = editors[0];
                code = editor.getValue();
                const model = editor.getModel && editor.getModel();
                if (model && typeof model.getLanguageId === 'function') {
                    languageId = model.getLanguageId();
                }
            }

            if (code === null && typeof window.monaco.editor.getModels === 'function') {
                const models = window.monaco.editor.getModels();
                if (models.length > 0) {
                    code = models[0].getValue();
                    languageId = models[0].getLanguageId();
                }
            }
        }

        document.dispatchEvent(new CustomEvent('LeetCodeCodeSaver_CodeExtracted', {
            detail: { code: code, languageId: languageId }
        }));
    } catch (e) {
        document.dispatchEvent(new CustomEvent('LeetCodeCodeSaver_CodeExtracted', {
            detail: { code: null, languageId: null }
        }));
    }
})();
