"""
This module implements a FastAPI application that integrates with OpenAI's GPT-4 and ElevenLabs TTS API.
It receives chat messages, generates responses using GPT-4, converts the responses to speech using
ElevenLabs API, and streams audio and word alignments back to the client.

TODO: Add a rate limiter to the API for production use
"""

import os
import asyncio
import json

from dotenv import load_dotenv
import websockets
import uvicorn
from fastapi import FastAPI, Request
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from openai import AsyncOpenAI

# Load environment variables from .env file
load_dotenv()

# Constants
VOICE_ID = 'nPczCjzI2devNBz1zQrb'
VOICE_MODEL_ID = 'eleven_turbo_v2_5'
VOICE_SETTINGS = {
    "stability": 0.5,
    "similarity_boost": 0.8,
    "use_speaker_boost": False
}

# Initialize the FastAPI app
app = FastAPI(
    title="Chat API with TTS",
    description="An API that streams GPT-4 responses and converts them to speech using ElevenLabs TTS.",
    version="1.0.0"
)

# Allow all CORS origins (for demo purposes only)
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.post("/chat")
async def chat(request: Request):
    """
    The main endpoint that handles chat interactions.
    It receives the entire chat context from the user, forwards it to the OpenAI API,
    streams the response, converts it to speech using ElevenLabs API,
    and streams the audio back to the client.
    """
    # Extract the messages from the request
    body = await request.json()
    messages = body.get('messages')

    # Set up OpenAI API key
    chat_client = AsyncOpenAI(api_key=os.getenv("OPENAI_API_KEY"))
   
    # Define an async generator to stream the chat response
    async def chat_response_stream():
        # Call OpenAI's completion API asynchronously with the full context
        response = await chat_client.chat.completions.create(
            model='gpt-4',
            messages=messages,
            temperature=1,
            stream=True
        )
        
        # Stream the response content
        async for chunk in response:
            delta = chunk.choices[0].delta
            content = delta.content
            if content:
                yield content

    # Use text_chunker to process the response text
    chat_response_chunks = text_chunker(chat_response_stream())

    # Return a streaming response that combines TTS and text alignment
    return StreamingResponse(elevenlabs_stream(chat_response_chunks), media_type="text/event-stream")

async def elevenlabs_stream(text_iterator):
    """
    Connects to ElevenLabs API via WebSocket to stream text-to-speech audio
    and word alignments in real-time.

    Parameters:
    - text_iterator: An async iterator that yields text chunks.

    Yields:
    - Server-Sent Events (SSE) containing audio data and word timings.
    """
    uri = f"wss://api.elevenlabs.io/v1/text-to-speech/{VOICE_ID}/stream-input?model_id={VOICE_MODEL_ID}"

    # Connect to the WebSocket
    async with websockets.connect(uri) as websocket:
        # Send initial message to establish connection
        await websocket.send(json.dumps({
            "text": " ",
            "voice_settings": VOICE_SETTINGS,
            "xi_api_key": os.getenv("ELEVENLABS_API_KEY"),
        }))

        queue = asyncio.Queue()

        # Coroutine to send text chunks to the WebSocket
        async def send_text():
            async for text in text_iterator:
                await websocket.send(json.dumps({"text": text}))
            # Send a flush signal to indicate end of text
            await websocket.send(json.dumps({"text": " ", "flush": True}))

        # Coroutine to receive data from the WebSocket and put it into the queue
        async def receive_data():
            cumulative_run_time = 0
            received_final_chunk = False
            while not received_final_chunk:
                try:
                    message = await websocket.recv()
                    data = json.loads(message)
                    if data.get("audio"):
                        # Audio data is base64 encoded
                        audio_data = data["audio"]
                        sse_message = f"data: {json.dumps({'type': 'audio', 'data': audio_data})}\n\n"
                        await queue.put(sse_message)
                    if data.get("alignment"):
                        alignment_info = data.get("alignment")
                        words, word_start_times, cumulative_run_time = calculate_word_start_times(
                            alignment_info, cumulative_run_time
                        )
                        sse_message = f"data: {json.dumps({'type': 'word_times', 'data': {'words': words, 'wordStartTimesMs': word_start_times}})}\n\n"
                        await queue.put(sse_message)
                    if data.get('isFinal'):
                        received_final_chunk = True
                except websockets.exceptions.ConnectionClosed:
                    break
            await queue.put(None)  # Signal that we're done

        # Run send_text and receive_data concurrently
        send_task = asyncio.create_task(send_text())
        receive_task = asyncio.create_task(receive_data())

        # While data is available in the queue, yield it
        while True:
            data = await queue.get()
            if data is None:
                break
            yield data

        # Ensure all tasks are completed
        await send_task
        await receive_task

async def text_chunker(text_generator):
    """
    Splits the text into chunks, ensuring that sentences are not broken.

    Parameters:
    - text_generator: An async generator that yields text.

    Yields:
    - Text chunks suitable for sending to the TTS service.
    """
    splitters = (".", ",", "?", "!", ";", ":", "—", "-", "(", ")", "[", "]", "}", " ")
    buffer = ""

    async for text in text_generator:
        if buffer.endswith(splitters):
            yield buffer + " "
            buffer = text
        elif text.startswith(splitters):
            yield buffer + text[0] + " "
            buffer = text[1:]
        else:
            buffer += text

    if buffer:
        yield buffer + " "

def calculate_word_start_times(alignment_chunk, cumulative_run_time):
    """
    Calculates the start times of words based on character alignments.

    Parameters:
    - alignment_chunk: Alignment data received from the TTS service.
    - cumulative_run_time: The cumulative duration up to the current point.

    Returns:
    - words: List of words extracted.
    - word_start_times: Corresponding start times for each word.
    - cumulative_run_time: Updated cumulative duration.
    """
    # Adjust character start times to be cumulative
    adjusted_char_start_times = [time + cumulative_run_time for time in alignment_chunk['charStartTimesMs']]
    
    # Pair characters with their adjusted start times
    zipped_chars_times = list(zip(alignment_chunk['chars'], adjusted_char_start_times))
    
    # Find word boundaries and start times
    words = []
    word_start_times = []
    word = ''
    word_start_time = None
    for char, time in zipped_chars_times:
        if char == ' ':
            if word:
                words.append(word)
                word_start_times.append(word_start_time)
                word = ''
                word_start_time = None
        else:
            if not word:
                word_start_time = time
            word += char
    if word:
        words.append(word)
        word_start_times.append(word_start_time)
    
    # Calculate total duration of the chunk
    if 'charDurationsMs' in alignment_chunk and alignment_chunk['charDurationsMs']:
        total_duration = sum(alignment_chunk['charDurationsMs'])
    else:
        if adjusted_char_start_times:
            total_duration = adjusted_char_start_times[-1] - adjusted_char_start_times[0] + 100  # Added 100ms buffer
        else:
            total_duration = 0
    
    # Update cumulative_run_time
    cumulative_run_time += total_duration
    
    return words, word_start_times, cumulative_run_time

def start():
    uvicorn.run("src.main:app", host="0.0.0.0", port=8000, reload=True)

if __name__ == "__main__":
    start()
