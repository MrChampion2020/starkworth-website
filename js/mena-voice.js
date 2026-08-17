// Mena voice mode: speech input (mic), speech output (voice-over), and
// multilingual support via the mena-translate Edge Function.
//
// Mena's KB matching (js/chatbot.js) is English-only, so non-English
// input is translated to English before matching, and English replies
// are translated back to the visitor's chosen language before being
// spoken and displayed. If translation isn't configured/available, this
// degrades gracefully to English-only rather than breaking the chat.
(function () {
  const LANG_KEY = 'sw_mena_lang';
  const VOICE_REPLIES_KEY = 'sw_mena_voice_replies';

  // BCP-47 codes: `translate` is what the translation API expects,
  // `speech` is what SpeechRecognition/SpeechSynthesis expect (usually a
  // more specific regional tag). Kept to a curated, well-supported list
  // rather than every possible language — easy to extend.
  const LANGUAGES = [
    { code: 'en', label: 'English', translate: 'en', speech: 'en-US' },
    { code: 'es', label: 'Español', translate: 'es', speech: 'es-ES' },
    { code: 'fr', label: 'Français', translate: 'fr', speech: 'fr-FR' },
    { code: 'de', label: 'Deutsch', translate: 'de', speech: 'de-DE' },
    { code: 'pt', label: 'Português', translate: 'pt', speech: 'pt-PT' },
    { code: 'it', label: 'Italiano', translate: 'it', speech: 'it-IT' },
    { code: 'nl', label: 'Nederlands', translate: 'nl', speech: 'nl-NL' },
    { code: 'ar', label: 'العربية', translate: 'ar', speech: 'ar-SA' },
    { code: 'hi', label: 'हिन्दी', translate: 'hi', speech: 'hi-IN' },
    { code: 'zh', label: '中文', translate: 'zh-CN', speech: 'zh-CN' },
    { code: 'ja', label: '日本語', translate: 'ja', speech: 'ja-JP' },
    { code: 'ko', label: '한국어', translate: 'ko', speech: 'ko-KR' },
    { code: 'ru', label: 'Русский', translate: 'ru', speech: 'ru-RU' },
    { code: 'sw', label: 'Kiswahili', translate: 'sw', speech: 'sw-KE' },
    { code: 'yo', label: 'Yorùbá', translate: 'yo', speech: 'yo-NG' },
    { code: 'ha', label: 'Hausa', translate: 'ha', speech: 'ha-NG' },
    { code: 'ig', label: 'Igbo', translate: 'ig', speech: 'ig-NG' },
    { code: 'af', label: 'Afrikaans', translate: 'af', speech: 'af-ZA' },
  ];

  function getLangEntry(code) {
    return LANGUAGES.find((l) => l.code === code) || LANGUAGES[0];
  }

  function getSelectedLang() {
    return localStorage.getItem(LANG_KEY) || 'en';
  }

  function setSelectedLang(code) {
    localStorage.setItem(LANG_KEY, code);
  }

  function getVoiceRepliesEnabled() {
    return localStorage.getItem(VOICE_REPLIES_KEY) === '1';
  }

  function setVoiceRepliesEnabled(on) {
    localStorage.setItem(VOICE_REPLIES_KEY, on ? '1' : '0');
  }

  function isSpeechInputSupported() {
    return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
  }

  function isSpeechOutputSupported() {
    return !!window.speechSynthesis;
  }

  function stripHtml(html) {
    const div = document.createElement('div');
    div.innerHTML = html;
    return (div.textContent || div.innerText || '').trim();
  }

  // Translates text via the mena-translate Edge Function. Fails soft: on
  // any error (network, not-yet-configured, quota), returns the original
  // text unchanged with translated:false, rather than breaking the chat.
  async function translate(text, targetLang, sourceLang) {
    if (!text) return { text, translated: false };
    if (sourceLang && sourceLang === targetLang) return { text, translated: false };
    try {
      const response = await fetch(`${SUPABASE_URL}/functions/v1/mena-translate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({ text, targetLang, sourceLang }),
      });
      const data = await response.json();
      if (data && data.ok && data.translatedText) {
        return { text: data.translatedText, translated: true, detectedSourceLang: data.detectedSourceLang };
      }
      return { text, translated: false, error: data && data.error };
    } catch (err) {
      return { text, translated: false, error: String(err) };
    }
  }

  // Translates a visitor's message (in their selected language) to
  // English so it can be matched against js/chatbot.js's KB.
  async function toEnglish(text, fromLangCode) {
    if (fromLangCode === 'en') return { text, translated: false };
    const entry = getLangEntry(fromLangCode);
    return translate(text, 'en', entry.translate);
  }

  // Translates Mena's English reply to the visitor's selected language.
  // Strips HTML first since translation APIs and speech synthesis both
  // want plain text — links in replies are re-added as a plain "See:
  // <url>" line so the information isn't silently dropped.
  async function fromEnglish(html, toLangCode) {
    if (toLangCode === 'en') return { text: stripHtml(html), translated: false, html };
    const entry = getLangEntry(toLangCode);
    const plain = stripHtml(html);
    const result = await translate(plain, entry.translate, 'en');
    return { ...result, html };
  }

  let recognition = null;
  function startListening(langCode, onResult, onError, onEnd) {
    const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognitionCtor) {
      onError && onError('Voice input is not supported in this browser. Try Chrome, Edge, or Safari.');
      return;
    }
    recognition = new SpeechRecognitionCtor();
    recognition.lang = getLangEntry(langCode).speech;
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event) => {
      const transcript = event.results[0][0].transcript;
      onResult && onResult(transcript);
    };
    recognition.onerror = (event) => {
      onError && onError(event.error === 'not-allowed'
        ? 'Microphone access was denied — allow it in your browser to use voice input.'
        : 'Voice input error: ' + event.error);
    };
    recognition.onend = () => onEnd && onEnd();

    recognition.start();
  }

  function stopListening() {
    if (recognition) recognition.stop();
  }

  function speak(text, langCode) {
    if (!isSpeechOutputSupported() || !text) return;
    window.speechSynthesis.cancel(); // Don't let replies queue/overlap.
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = getLangEntry(langCode).speech;
    window.speechSynthesis.speak(utterance);
  }

  function stopSpeaking() {
    if (isSpeechOutputSupported()) window.speechSynthesis.cancel();
  }

  window.MenaVoice = {
    LANGUAGES,
    stripHtml,
    getLangEntry,
    getSelectedLang,
    setSelectedLang,
    getVoiceRepliesEnabled,
    setVoiceRepliesEnabled,
    isSpeechInputSupported,
    isSpeechOutputSupported,
    toEnglish,
    fromEnglish,
    startListening,
    stopListening,
    speak,
    stopSpeaking,
  };
})();
