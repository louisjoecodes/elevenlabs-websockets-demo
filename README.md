
![hero](https://github.com/user-attachments/assets/b1b9d5e2-e030-4c3e-a4bc-0a15d76b876c)

# ElevenLabs Real-Time TTS Demo

This project demonstrates real-time text-to-speech (TTS) using ElevenLabs API with WebSocket streaming and text highlighting. It showcases the newly introduced timestamps feature in the Elevenlabs Websockets API.

## Features

- Real-time text-to-speech conversion
- WebSocket streaming for low-latency audio playback
- Text highlighting synchronized with speech
- Responsive UI built with Next.js and Tailwind CSS (+Shadcn components)
- Backend powered by FastAPI and Python

## Demo
https://github.com/user-attachments/assets/71b4c6d9-9dda-45c8-b646-cb8ae01820a4

## Getting Started

### Prerequisites

- Node.js (v14 or later)
- Python (v3.9 or later)
- Poetry (for Python dependency management)

### Installation

1. Clone the repository:

   ```
   git clone https://github.com/your-username/elevenlabs-realtime-tts-demo.git
   cd elevenlabs-realtime-tts-demo
   ```

2. Set up the frontend:

   ```
   cd frontend
   npm install
   ```

3. Set up the backend:

   ```
   cd backend
   poetry install
   ```

4. Create a `.env` file in the `backend` directory and update elevenlabs and openai api keys
   ```
   cp .env.example .env
   ```

### Running the Application

1. Start the backend server:

   ```
   cd backend
   poetry run start
   ```

2. In a new terminal, start the frontend development server:

   ```
   cd frontend
   npm run dev
   ```

3. Open your browser and navigate to `http://localhost:3000` to use the application.

## License

This project is licensed under the MIT License
