import { initializeApp } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";
import { getDatabase } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyAu2T1AJYTZ1oAsKog97UAZOCAk6eenTHQ",
  authDomain: "space-chat-73e54.firebaseapp.com",
  databaseURL: "https://space-chat-73e54-default-rtdb.firebaseio.com",
  projectId: "space-chat-73e54",
  storageBucket: "space-chat-73e54.firebasestorage.app",
  messagingSenderId: "87243819094",
  appId: "1:87243819094:web:4576dfb74c8c22cfad53f7",
  measurementId: "G-F6611GP79F",
};

const firebaseApp = initializeApp(firebaseConfig);

export const auth = getAuth(firebaseApp);
export const db = getDatabase(firebaseApp);
