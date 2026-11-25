function saveOptions(e) {
    e.preventDefault();
    var btn = document.querySelector('button[type="submit"]');
    var prefs = {
        enabledAtStartup: document.getElementById('enabledAtStartup').checked || false,
        activationList: document.getElementById('activationList').value || ''
    };
    browser.storage.local.set(prefs).then(function() {
        return browser.runtime.getBackgroundPage();
    }).then(function(bg) {
        if (bg && typeof bg.loadPrefs === 'function'){bg.loadPrefs(restoreOptions);}
        else {restoreOptions();}
        if (btn) {
            btn.textContent = 'Saved!';
            btn.style.backgroundColor = '#81c784';
            setTimeout(function() {
                btn.textContent = 'Save';
                btn.style.backgroundColor = '';
            }, 3000);
        }
    });
}
function restoreOptions() {
    browser.storage.local.get(['enabledAtStartup', 'activationList']).then(function(res) {
        document.getElementById('enabledAtStartup').checked = res.enabledAtStartup || false;
        document.getElementById('activationList').value = res.activationList || '';
    });
}
document.addEventListener('DOMContentLoaded', restoreOptions);
document.querySelector('form').addEventListener('submit', saveOptions);
