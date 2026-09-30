#!/usr/bin/env python3
"""Writes tests/fixtures/local-ai/tiny-test.gguf: a tiny llama-architecture model with random weights.

It says nothing sensible. It exists so Local AI's runtime (load, stream, cancel, unload, crash and restart) can
be tested with the real llama.cpp engine without downloading a real model. Deterministic (fixed seed).
    pip install gguf numpy && python3 scripts/make-test-gguf.py
"""
import os
import numpy as np
import gguf

OUT = os.path.join(os.path.dirname(__file__), '..', 'tests', 'fixtures', 'local-ai', 'tiny-test.gguf')
rng = np.random.default_rng(7)
N_EMBD, N_HEAD, N_LAYER, N_FF, CTX = 64, 4, 2, 128, 2048

# A SentencePiece-style vocabulary: specials, the 256 byte tokens, then printable characters.
tokens = [b'<unk>', b'<s>', b'</s>'] + [f'<0x{i:02X}>'.encode() for i in range(256)]
chars = [chr(c) for c in range(32, 127)]
tokens += [c.encode() for c in chars]
scores = [0.0] * len(tokens)
types = [2, 3, 3] + [6] * 256 + [1] * len(chars)  # unknown, control, control, byte…, normal…
N_VOCAB = len(tokens)

w = gguf.GGUFWriter(OUT, 'llama')
w.add_name('WorkSuite tiny test model')
w.add_context_length(CTX)
w.add_embedding_length(N_EMBD)
w.add_block_count(N_LAYER)
w.add_feed_forward_length(N_FF)
w.add_head_count(N_HEAD)
w.add_head_count_kv(N_HEAD)
w.add_rope_dimension_count(N_EMBD // N_HEAD)
w.add_layer_norm_rms_eps(1e-5)
w.add_file_type(gguf.LlamaFileType.ALL_F32)
w.add_tokenizer_model('llama')
w.add_token_list(tokens)
w.add_token_scores(scores)
w.add_token_types(types)
w.add_bos_token_id(1)
w.add_eos_token_id(2)
w.add_unk_token_id(0)
w.add_add_bos_token(True)
w.add_chat_template("{% for m in messages %}{{ m['role'] }}: {{ m['content'] }}\n{% endfor %}{% if add_generation_prompt %}assistant: {% endif %}")

def t(name, *shape):
    w.add_tensor(name, (rng.standard_normal(shape) * 0.02).astype(np.float32))

t('token_embd.weight', N_VOCAB, N_EMBD)
w.add_tensor('output_norm.weight', np.ones(N_EMBD, dtype=np.float32))
t('output.weight', N_VOCAB, N_EMBD)
for i in range(N_LAYER):
    w.add_tensor(f'blk.{i}.attn_norm.weight', np.ones(N_EMBD, dtype=np.float32))
    for n in ('attn_q', 'attn_k', 'attn_v', 'attn_output'):
        t(f'blk.{i}.{n}.weight', N_EMBD, N_EMBD)
    w.add_tensor(f'blk.{i}.ffn_norm.weight', np.ones(N_EMBD, dtype=np.float32))
    t(f'blk.{i}.ffn_gate.weight', N_FF, N_EMBD)
    t(f'blk.{i}.ffn_up.weight', N_FF, N_EMBD)
    t(f'blk.{i}.ffn_down.weight', N_EMBD, N_FF)

w.write_header_to_file()
w.write_kv_data_to_file()
w.write_tensors_to_file()
w.close()
print(OUT, os.path.getsize(OUT))
