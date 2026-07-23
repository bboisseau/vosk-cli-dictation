import queue, time, json, pyaudio
from vosk import Model, KaldiRecognizer

model = Model('vosk-model/vosk-model-en-us-0.22-lgraph')
rec = KaldiRecognizer(model, 16000)
q = queue.Queue()

pa = pyaudio.PyAudio()
stream = pa.open(format=pyaudio.paInt16, channels=1, rate=16000, input=True, frames_per_buffer=4096)

print('Say something now (4 seconds)...')
for _ in range(int(16000 / 4096 * 4)):
    data = stream.read(4096, exception_on_overflow=False)
    q.put(data)

stream.stop_stream()
stream.close()
pa.terminate()

print(f'Got {q.qsize()} audio chunks')
count = 0
while not q.empty():
    data = q.get()
    count += 1
    if rec.AcceptWaveform(data):
        r = json.loads(rec.Result())
        print('Intermediate result:', r)
print(f'Processed {count} chunks')
print('Final result:', json.loads(rec.FinalResult()))
