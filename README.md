
  # AI Note Keeper

  AI Note Keeper is a simple, cross-platform note-taking app with smart features for capturing, organizing, and syncing notes
  across web and mobile.

  ## Project Overview

  This project includes:

  - **Web App** (`frontend/web`): React-based interface for creating, editing, and managing notes in the browser.
  - **Mobile App** (`frontend/mobile`): React Native (Expo) app for Android/iOS with on-the-go note access and reminders.
  - **Backend** (`backend`): Convex-powered backend for realtime data sync, functions, and app logic.

  ## Progress & Roadmap

  The project has completed its core features, including note creation, editing, syncing, and reminder foundations across
  web and mobile.

  ### What’s Next

  Planned upcoming features include:

  - **Voice-to-Note**: Create notes from speech input.
  - **User Authentication**: Add user login/signup and account-based data isolation.
  - **AI Agent Note Creation**: Let an AI assistant generate structured notes from user instructions.
  - Additional quality-of-life improvements for productivity and smarter note workflows.

  ---

  ## Web App

  The web app provides a fast, responsive experience for desktop and tablet users.

  ### Web App Screenshots

  <!-- Add web app screenshots below -->
  <img width="1407" height="974" alt="Screenshot 2026-03-02 172522" src="https://github.com/user-attachments/assets/7638e32b-80d4-446e-8d40-f8a38702b4fb" />
  <img width="615" height="478" alt="Screenshot 2026-03-02 172531" src="https://github.com/user-attachments/assets/2277957d-8ce9-4287-ae70-d77cb3fa3e58" />
  <img width="697" height="727" alt="Screenshot 2026-03-02 172535" src="https://github.com/user-attachments/assets/84712f0e-71da-439d-a294-c89265bf3d19" />

  ---

  ## Mobile App

  The mobile app is built with Expo + React Native for native-like performance and push/reminder support.

  ### Mobile App Screenshots

  <!-- Add mobile app screenshots below -->
  ![Screenshot_2026-03-01-10-07-10-561_com andersonho ainotekeeper](https://github.com/user-attachments/assets/aca3eb42-ad22-42e6-80a6-f9517ef3663a)
  ![Screenshot_2026-03-01-10-07-42-963_com andersonho ainotekeeper](https://github.com/user-attachments/assets/f3020c4c-f8c2-457e-b2e6-05d984cb817c)
  ![Screenshot_2026-03-01-10-07-38-739_com andersonho ainotekeeper](https://github.com/user-attachments/assets/237646c2-f457-47b4-88ea-3de5db6149d4)

  ---

  ## Convex Backend

  Convex handles:

  - Realtime note synchronization
  - Backend functions and business logic
  - Data persistence and querying
  - Support for reminder/sync workflows

  ---

  ## Installation & Run

  ### 1. Clone and install dependencies

  ```bash
  git clone <your-repo-url>
  cd ai-note-keeper
  npm install

  ### 2. Run Convex backend

  cd backend
  npx convex dev

  ### 3. Run Web App

  cd frontend/web
  npm install
  npm run dev

  ### 4. Run Mobile App (Expo)

  cd frontend/mobile
  npm install
  npx expo start

  Then use:

  - a for Android emulator
  - i for iOS simulator (macOS)
  - Expo Go app for physical device testing

  ———

  ## Useful Commands

  npm test
  npm run lint
  ```
