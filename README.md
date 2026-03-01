
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
  <img width="2099" height="1625" alt="image" src="https://github.com/user-attachments/assets/2fea5270-1e10-4b0e-9d7b-6fd051ce0bd8" />
  <img width="1454" height="851" alt="image" src="https://github.com/user-attachments/assets/347d75de-2a11-44d0-90ce-a95d5f32d12b" />

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
