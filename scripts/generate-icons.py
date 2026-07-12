#!/usr/bin/env python3
"""Genera le icone PWA 192x192 e 512x512 per CieloBuio.

Usage:
    python3 scripts/generate-icons.py

Genera le icone in public/icon-192.png e public/icon-512.png.
Lo script usa solo la libreria standard (nessuna dipendenza esterna).
"""
import os
import struct
import zlib

# I path sono relativi alla directory del progetto, calcolati a partire
# dalla posizione di questo script, così funziona da qualunque working
# directory.
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(SCRIPT_DIR)
PUBLIC_DIR = os.path.join(PROJECT_ROOT, "public")

def crea_png_png(width, height, pixels):
    """Crea un file PNG grezzo da una matrice di pixel RGB."""
    def chunk(tipo, dati):
        c = tipo + dati
        return struct.pack(">I", len(dati)) + c + struct.pack(">I", zlib.crc32(c) & 0xffffffff)

    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    raw = b""
    for y in range(height):
        raw += b"\x00"  # filter type 0
        for x in range(width):
            r, g, b = pixels[y * width + x]
            raw += struct.pack("BBB", r, g, b)
    compressed = zlib.compress(raw, 9)
    return sig + chunk(b"IHDR", ihdr) + chunk(b"IDAT", compressed) + chunk(b"IEND", b"")

def genera_icona(size):
    """Genera un'icona con sfondo indaco e testo 'CB' semplificato."""
    # Colore indaco del brand: #2A2D5F (oklch 0.42 0.13 264)
    bg = (42, 45, 95)
    fg = (244, 244, 245)  # bianco
    
    pixels = []
    for y in range(size):
        for x in range(size):
            # Cornice
            if x < size // 20 or x >= size - size // 20 or y < size // 20 or y >= size - size // 20:
                pixels.append(bg)
                continue
            
            # Disegna "CB" in modo molto semplificato: due blocchi
            cx = size // 2
            cy = size // 2
            # C: arco sinistra
            letter_w = size // 5
            letter_h = size // 2
            spacing = size // 12
            
            # Posizione C
            c_x_start = cx - letter_w - spacing - letter_w // 2
            c_x_end = c_x_start + letter_w
            # Posizione B  
            b_x_start = cx + spacing - letter_w // 2
            b_x_end = b_x_start + letter_w
            
            c_y_start = cy - letter_h // 2
            c_y_end = cy + letter_h // 2
            
            in_c = False
            # Lettera C: rettangolo con asola a destra
            if c_x_start <= x <= c_x_end and c_y_start <= y <= c_y_end:
                # Cavo interno a destra
                hole_x_start = c_x_end - letter_w // 3
                hole_y_start = c_y_start + letter_h // 4
                hole_y_end = c_y_end - letter_h // 4
                if not (hole_x_start <= x <= c_x_end and hole_y_start <= y <= hole_y_end):
                    in_c = True
            
            in_b = False
            # Lettera B: due rigonfiamenti
            if b_x_start <= x <= b_x_end and c_y_start <= y <= c_y_end:
                # Struttura B: 2 rettangoli orizzontali + asole
                bar1_y = c_y_start
                bar1_y_end = c_y_start + letter_h // 4
                bar2_y = cy - letter_h // 8
                bar2_y_end = cy + letter_h // 8
                bar3_y = c_y_end - letter_h // 4
                bar3_y_end = c_y_end
                
                # Asola superiore
                asola1_x_end = b_x_start + letter_w * 3 // 4
                asola1_y_start = bar1_y_end
                asola1_y_end = bar2_y - 1
                # Asola inferiore
                asola2_x_end = b_x_start + letter_w * 3 // 4
                asola2_y_start = bar2_y_end + 1
                asola2_y_end = bar3_y
                
                if bar1_y <= y <= bar1_y_end: in_b = True
                elif bar2_y <= y <= bar2_y_end: in_b = True
                elif bar3_y <= y <= bar3_y_end: in_b = True
                elif b_x_start <= x <= b_x_start + letter_w // 4 and c_y_start <= y <= c_y_end: in_b = True  # asta sinistra
                elif asola1_x_end >= x and asola1_y_start <= y <= asola1_y_end: in_b = True
                elif asola2_x_end >= x and asola2_y_start <= y <= asola2_y_end: in_b = True
            
            if in_c or in_b:
                pixels.append(fg)
            else:
                pixels.append(bg)
    
    return crea_png_png(size, size, pixels)

# Genera le icone (path relativi alla root del progetto, non più hardcoded)
os.makedirs(PUBLIC_DIR, exist_ok=True)

with open(os.path.join(PUBLIC_DIR, "icon-192.png"), "wb") as f:
    f.write(genera_icona(192))
print("icon-192.png generata")

with open(os.path.join(PUBLIC_DIR, "icon-512.png"), "wb") as f:
    f.write(genera_icona(512))
print("icon-512.png generata")
