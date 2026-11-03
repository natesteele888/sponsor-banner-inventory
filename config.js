/**
 * Public settings. There are no secrets here: the backend checks each person's
 * LYBS Dashboard sign-in and role on every request (see apps-script/Code.gs).
 */
window.APP_CONFIG = {
  APPS_SCRIPT_URL: 'https://script.google.com/macros/s/AKfycbyY2MHbPp37YtO1nPDm_kJwL6GFW4gkZhP_4OSD1UFqkHwt6n2o2yomQCG6tSjTQ83y/exec',
  FIREBASE: {
    apiKey: 'AIzaSyAnFzm4QNqrEtre71SbTjG45w0SlLQ-8QA',
    authDomain: 'lybs-dashboard.firebaseapp.com',
    projectId: 'lybs-dashboard',
    storageBucket: 'lybs-dashboard.firebasestorage.app',
    messagingSenderId: '951495325870',
    appId: '1:951495325870:web:6af89f00d25f74f4ff953f'
  }
};
