import { initializeApp } from 'firebase/app'
import { getAuth } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'
import { getStorage } from 'firebase/storage'

const firebaseConfig = {
  // apiKey: "AIzaSyCbFvC9C2b6IbrJ6kPHeBshNwkX8UrwK3I",
  authDomain: "jct-wms.firebaseapp.com",
  projectId: "jct-wms",
  storageBucket: "jct-wms.firebasestorage.app",
  messagingSenderId: "563922884544",
  appId: "1:563922884544:web:6964b294b9c9c6ef4eda25"
}

const app = initializeApp(firebaseConfig)

export const auth = getAuth(app)
export const db = getFirestore(app)
export const storage = getStorage(app)