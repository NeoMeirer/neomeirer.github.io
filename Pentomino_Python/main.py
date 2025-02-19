import pygame
import sys
import time


# Konstanten
SCREEN_WIDTH, SCREEN_HEIGHT = 3000, 1800
GRID_SIZE = min(round(SCREEN_WIDTH // 45), round(SCREEN_HEIGHT // 27))  # Passe die Größe des Gitters an
GRID_ROWS, GRID_COLS = 6, 10
BOARD_X, BOARD_Y = round((SCREEN_WIDTH - GRID_COLS * GRID_SIZE) // 2), round((SCREEN_HEIGHT - GRID_ROWS * GRID_SIZE // 4) // 2)

# Alexanders Farbschema
WHITE = (211, 215, 207)
BLACK = (0, 0, 0)
Burgundy = (126, 0, 0)
RED = (239, 41, 41)
DARK_BLUE = (31, 74, 135)
LIGHT_BLUE = (113, 159, 207)
DARK_GREEN = (85, 134, 6)
LIGHT_GREEN = (138, 226, 52)
YELLOW = (252, 233, 79)
ORANGE = (252, 175, 62)
PINK = (173, 127, 168)
CYAN = (92, 53, 102)
BROWN = (193, 125, 17)
GRAY = (85, 87, 83)
# Farbe hinzufügen, Änderung Zeile 116, 300 und eventuell 296 (transparente Darstellung)


# Initialisierung
pygame.init()
screen = pygame.display.set_mode((SCREEN_WIDTH, SCREEN_HEIGHT), pygame.SRCALPHA)  # ", pygame.SRCALPHA" SRCALPHA für Alpha-Transparenz (Kompatibilität)
pygame.display.set_caption("Pentomino")
clock = pygame.time.Clock()

# Schriftart und Größe festlegen
font_headline = pygame.font.Font(None, round(GRID_SIZE * 2))  # "None" bedeutet die Standardschriftart, 36 ist die Größe   
font_player = pygame.font.Font(None, round(GRID_SIZE))  # "None" bedeutet die Standardschriftart, die Größe wird gerundet
font = pygame.font.Font(None, round(GRID_SIZE // 1.5))  # Schriftart für die Aktionen

# Farbe für den Text (RGB)
text_color = (0, 0, 0)  # Black

# Text rendern (Erzeugt ein neues Bild mit dem Text)
headline_surface = font_headline.render("Pentomino", True, text_color)

# Position des Textes
headline_rect = headline_surface.get_rect(center=(SCREEN_WIDTH // 2, SCREEN_HEIGHT // 2.5))  # Zentriert in der Mitte des Fensters

# Der anzuzeigende Text
player1_text = "Player 1"
player2_text = "Player 2"

# Berechne die Breite des gesamten Textes
player_text_width = sum(font_player.size(letter)[0] for letter in player1_text)

# Startposition für den ersten Buchstaben
line_spacing = GRID_SIZE // 2  # Abstand zwischen den Buchstaben
player1_x = BOARD_X - GRID_SIZE // 2 # links
player2_x = BOARD_X + GRID_SIZE * GRID_COLS + GRID_SIZE // 2  # rechts
player_y = BOARD_Y + (GRID_ROWS * GRID_SIZE) // 2 - player_text_width // 2 - line_spacing  # Vertikal mittig am Spielfeld



# Spielsteine (Pentomino-Formen, bestehend aus 5 Quadraten)
shapes = {
    "l": [(0,0), (1,0), (2,0), (3,0), (3,1)],  # l-förmig
    "Z": [(0, 0), (1,0), (1,1), (1,2), (2,2)],  # Z-förmig
    "U": [(0,0), (0,2), (1,0), (1,1), (1,2)],  # U-förmig
    "T": [(0,0), (1,0), (2,0), (1,1), (1,2)], # T-förmig
    "F1": [(0,1), (1,0), (1,1), (1,2), (2,2)],  # F-förmig (entfernt)
    "Blitz": [(0,0), (1,0), (2,0), (2,1), (3,1)], # Blitz-förmig
    "X": [(0,1), (1,0), (1,1), (1,2), (2,1)],  # X-förmig (Kreuz)
    "F2": [(0,0), (1,0), (2,0), (3,0), (2,1)], # F-förmig (entfernt)
    "I": [(0,0), (1,0), (2,0), (3,0), (4,0)],  # Gerade Linie
    "W": [(0,2), (1,2), (1,1), (2,1), (2,0)],  # W-förmig
    "L": [(0,0), (1,0), (2,0), (2,1), (2,2)],  # L-förmig
    "Stuhl": [(0,0), (0,1), (1,0), (1,1), (2,0)]  # Stuhl-förmig
}


colors = [Burgundy, LIGHT_GREEN, YELLOW, RED, BROWN, DARK_BLUE, ORANGE, DARK_GREEN, CYAN, LIGHT_BLUE, GRAY, PINK]

pieces = []
num_columns = 6  # Maximal 6 Steine pro Reihe

# Berechnung der Start-X-Position, um die Steine mittig auszurichten
start_x = (SCREEN_WIDTH - (BOARD_X // 2 + num_columns * GRID_SIZE * 4)) // 2

for i, (name, shape) in enumerate(shapes.items()):
    x = start_x + (i % num_columns) * GRID_SIZE * 6
    y = GRID_SIZE + (i // num_columns) * GRID_SIZE * 4  # Zweite Reihe etwas tiefer
    
    piece = {
        "shape": shape,
        "color": colors[i % len(colors)],
        "pos": (x, y),
    }
    pieces.append(piece)

selected_piece = None 

def draw_grid():
    for row in range(GRID_ROWS + 1):
        pygame.draw.aaline(screen, BLACK, (BOARD_X, BOARD_Y + row * GRID_SIZE),  # aaline statt line für mögliche höhere Kompatibilität und Qualität (Anti-Aliasing)
                         (BOARD_X + GRID_COLS * GRID_SIZE, BOARD_Y + row * GRID_SIZE))
    for col in range(GRID_COLS + 1):
        pygame.draw.aaline(screen, BLACK, (BOARD_X + col * GRID_SIZE, BOARD_Y),
                         (BOARD_X + col * GRID_SIZE, BOARD_Y + GRID_ROWS * GRID_SIZE))

def draw_pieces():
    for piece in pieces:
        for square in piece["shape"]:
            x, y = piece["pos"]
            rect = pygame.Rect(x + square[0] * GRID_SIZE, y + square[1] * GRID_SIZE, GRID_SIZE, GRID_SIZE)
            pygame.draw.rect(screen, piece["color"], rect) # statt piece["color"] einfach einheitliche farbe, um die Steine besser zu unterscheiden
            pygame.draw.rect(screen, BLACK, rect, 1)


def draw_selected_pieces_p1():
    # Berechne die mittige X-Position für die Steine von Spieler 1, rechts neben dem Spielfeld
    column_spacing =  GRID_SIZE * 8  # Abstand zwischen den Spalten
    row_spacing = GRID_SIZE * 5  # Abstand zwischen den Reihen
    start_x = BOARD_X - GRID_SIZE * 15  # Links neben dem Spielfeld
    
    # Berechne die mittige Y-Position für die Steine von Spieler 1
    total_height = 1.5 * row_spacing  # Höhe von 3 Reihen
    start_y = SCREEN_HEIGHT // 2.5 # gleiche Höhe wie "Pentomino" Text
    
    for i, piece in enumerate(selected_pieces_p1):
        # Berechnung der Spalte (0 = links, 1 = rechts)
        column = i % 2  # Zwei Spalten: 0 oder 1
        
        # Berechnung der Zeile innerhalb der Spalte
        row = i // 2  # Maximal 3 Reihen pro Spalte
        
        # Berechne die endgültige Position für jedes Stück
        piece_x = start_x + column * column_spacing  # Wechselt zwischen 1. und 2. Spalte
        piece_y = start_y + row * row_spacing  # Erhöht sich pro Reihe

        # 🛠 Korrigiere die gespeicherte Position
        piece["pos"] = (piece_x, piece_y)
        
        # Zeichne den Stein
        for square in piece["shape"]:
            rect = pygame.Rect(piece_x + square[0] * GRID_SIZE, piece_y + square[1] * GRID_SIZE, GRID_SIZE, GRID_SIZE)
            pygame.draw.rect(screen, piece["color"], rect)
            pygame.draw.rect(screen, BLACK, rect, 1)

def draw_selected_pieces_p2():
    # Offset für die Spielsteine neben dem Spielfeld
  
    column_spacing = GRID_SIZE * 8  # Abstand zwischen den Spalten
    row_spacing = GRID_SIZE * 5  # Abstand zwischen den Reihen
    
    # Start-X-Position für die erste Spalte (rechts neben dem Spielfeld)
    start_x = BOARD_X + GRID_COLS * GRID_SIZE + GRID_SIZE * 4  # Rechts neben dem Spielfeld
    
    # Berechnung der vertikalen Zentrierung (3 Reihen hoch)
    total_height = 1.5 * row_spacing  # Höhe von 3 Reihen
    start_y = SCREEN_HEIGHT // 2.5 # gleiche Höhe wie "Pentomino" Text 

    for i, piece in enumerate(selected_pieces_p2):
        # Berechnung der Spalte (0 = links, 1 = rechts)
        column = i % 2  # Zwei Spalten: 0 oder 1
        
        # Berechnung der Zeile innerhalb der Spalte
        row = i // 2  # Maximal 3 Reihen pro Spalte
        
        # Berechne die endgültige Position für jedes Stück
        piece_x = start_x + column * column_spacing  # Wechselt zwischen 1. und 2. Spalte
        piece_y = start_y + row * row_spacing  # Erhöht sich pro Reihe
        
        # 🛠 Korrigiere die gespeicherte Position
        piece["pos"] = (piece_x, piece_y)

        # Zeichne den Stein
        for square in piece["shape"]:
            rect = pygame.Rect(piece_x + square[0] * GRID_SIZE, piece_y + square[1] * GRID_SIZE, GRID_SIZE, GRID_SIZE)
            pygame.draw.rect(screen, piece["color"], rect)
            pygame.draw.rect(screen, BLACK, rect, 1)


def draw_actions(actions):
    """ Zeichnet die angegebenen Spiel-Aktionen unterhalb des Spielfelds. """
    start_y = BOARD_Y + GRID_ROWS * GRID_SIZE + 50  # Unterhalb des Spielfelds
    for i, action in enumerate(actions):
        action_surface = font.render(action, True, text_color)
        action_rect = action_surface.get_rect(center=(SCREEN_WIDTH // 2, start_y + i * 40))
        screen.blit(action_surface, action_rect)

def draw_player_turn():
    """ Zeichnet den aktuellen Spieler oben auf dem Bildschirm. """
    player_turn_text = f"Spieler Turn: {player_turn}"
    player_turn_surface = font_player.render(player_turn_text, True, text_color)
    player_turn_rect = player_turn_surface.get_rect(center=(SCREEN_WIDTH // 2, BOARD_Y - GRID_SIZE // 2))
    screen.blit(player_turn_surface, player_turn_rect)


reset_rect = None  # Globale Variable für den Reset-Button

def draw_winner(winner_text):
    """ Zeichnet den Gewinner und den Reset-Button auf den Bildschirm. """
    winner_surface = font_player.render(winner_text, True, text_color)
    winner_rect = winner_surface.get_rect(center=(SCREEN_WIDTH // 2, SCREEN_HEIGHT // 5))
    screen.blit(winner_surface, winner_rect)

    reset_surface = font_player.render("Reset", True, text_color)
    reset_rect = reset_surface.get_rect(center=(SCREEN_WIDTH // 2, SCREEN_HEIGHT // 5 + GRID_SIZE * 2))
    screen.blit(reset_surface, reset_rect)

    return reset_rect

def reset_game():
    """ Setzt das Spiel zurück. """
    global running, player_turn, draw_phase, in_placement_phase, selected_pieces_p1, selected_pieces_p2, pieces, selected_piece, ghost_pos, placed_pieces
    running = True
    player_turn = 1
    draw_phase = True
    in_placement_phase = False
    selected_pieces_p1 = []
    selected_pieces_p2 = []
    pieces = []
    selected_piece = None
    ghost_pos = None
    placed_pieces = []

    for i, (name, shape) in enumerate(shapes.items()):
        x = start_x + (i % num_columns) * GRID_SIZE * 6
        y = 50 + (i // num_columns) * GRID_SIZE * 4  # Zweite Reihe etwas tiefer
        
        piece = {
            "shape": shape,
            "color": colors[i % len(colors)],
            "pos": (x, y),
        }
        pieces.append(piece)


def rotate_piece(piece):
    """ Dreht ein Stück um 90 Grad und zentriert es. """
    shape = piece["shape"]
    
    # Berechne die minimale X- und Y-Koordinate der Form (um sie später korrekt zu positionieren)
    min_x = min([x for x, y in shape])
    min_y = min([y for x, y in shape])
    
    # Drehung um 90 Grad (x, y) → (-y, x)
    rotated_shape = [(-y, x) for x, y in shape]
    
    # Finde das neue Minimum nach der Drehung
    new_min_x = min([x for x, y in rotated_shape])
    new_min_y = min([y for x, y in rotated_shape])
    
    # Verschiebe die Form, damit sie weiterhin oben links ausgerichtet bleibt
    adjusted_shape = [(x - new_min_x, y - new_min_y) for x, y in rotated_shape]
    
    piece["shape"] = adjusted_shape

def mirror_piece(piece):
    """ Spiegelt das Stück an der vertikalen Achse und zentriert es. """
    shape = piece["shape"]
    
    # Berechne das minimale X der Form
    min_x = min([x for x, y in shape])
    
    # Spiegelung an der vertikalen Achse (x, y) → (-x, y)
    mirrored_shape = [(-x, y) for x, y in shape]
    
    # Finde das neue Minimum nach der Spiegelung
    new_min_x = min([x for x, y in mirrored_shape])
    
    # Verschiebe die Form, damit sie weiterhin oben links ausgerichtet bleibt
    adjusted_shape = [(x - new_min_x, y) for x, y in mirrored_shape]
    
    piece["shape"] = adjusted_shape



ghost_pos = None  # Speichert die Position des Ghost Pieces

def draw_ghost_piece(selected_piece):
    """ Zeichnet den aktuellen Stein als 'Ghost' (transparente Darstellung) auf das Spielfeld. """
    if not selected_piece or not ghost_pos:
        return  # Falls kein Stein ausgewählt oder kein Ghost Piece aktiv ist

    ghost_x, ghost_y = ghost_pos
    shape = selected_piece["shape"]

    for square in shape:
        x, y = ghost_x + square[0] * GRID_SIZE, ghost_y + square[1] * GRID_SIZE
        rect = pygame.Rect(x, y, GRID_SIZE, GRID_SIZE)

        # Halbtransparente Darstellung (mit Surface, da pygame.draw.rect kein Alpha unterstützt)
        ghost_surface = pygame.Surface((GRID_SIZE, GRID_SIZE), pygame.SRCALPHA)
        ghost_surface.fill((0, 0, 0, 70))  # Halbtransparent schwarz
        screen.blit(ghost_surface, (x, y))

        # Umrandung zeichnen
        pygame.draw.rect(screen, RED, rect, 1) # Umrandung für bessere Abgrenzung
        
def is_piece_inside_board(piece, position):
    """ Prüft, ob das gegebene Stück mit seiner Position im Spielfeld bleibt. """
    px, py = position

    for square in piece["shape"]:
        x, y = px + square[0] * GRID_SIZE, py + square[1] * GRID_SIZE

        if x < BOARD_X or x >= BOARD_X + GRID_COLS * GRID_SIZE or y < BOARD_Y or y >= BOARD_Y + GRID_ROWS * GRID_SIZE:
            return False

    return True


placed_pieces = []  # Liste für platzierte Steine

def place_piece(selected_piece):
    """ Platziert den ausgewählten Stein, wenn er gültig ist. """
    global player_turn

    if not selected_piece or not ghost_pos:
        return False  # Falls kein Stein ausgewählt oder keine gültige Position existiert

    px, py = ghost_pos
    shape = selected_piece["shape"]

    # Prüfen, ob der Stein mit einem bereits platzierten kollidiert
    for square in shape:
        x, y = px + square[0] * GRID_SIZE, py + square[1] * GRID_SIZE

        for placed_piece in placed_pieces:  # Gehe durch alle bereits gesetzten Steine
            placed_px, placed_py = placed_piece["pos"]
            for placed_square in placed_piece["shape"]:
                placed_x = placed_px + placed_square[0] * GRID_SIZE
                placed_y = placed_py + placed_square[1] * GRID_SIZE

                if pygame.Rect(x, y, GRID_SIZE, GRID_SIZE).colliderect(
                        pygame.Rect(placed_x, placed_y, GRID_SIZE, GRID_SIZE)):
                    print("⚠️ Stein überlappt mit einem anderen Stein!")
                    return False  # Platzierung ist ungültig

    # Stein kann platziert werden
    placed_pieces.append({
        "shape": shape,
        "color": selected_piece["color"],
        "pos": (px, py)
    })

    # Entferne den Stein aus der Auswahl des aktuellen Spielers
    if player_turn == 1:
        if selected_piece in selected_pieces_p1:
            selected_pieces_p1.remove(selected_piece)
        player_turn = 2  # Wechsel zu Spieler 2
    else:
        if selected_piece in selected_pieces_p2:
            selected_pieces_p2.remove(selected_piece)
        player_turn = 1  # Wechsel zu Spieler 1


    return True  # Erfolgreiche Platzierung


def draw_placed_pieces():
    """ Zeichnet alle platzierten Steine auf dem Spielfeld. """
    for piece in placed_pieces:
        px, py = piece["pos"]  # Startposition des platzierten Steins
        for square in piece["shape"]:
            x = px + square[0] * GRID_SIZE
            y = py + square[1] * GRID_SIZE
            rect = pygame.Rect(x, y, GRID_SIZE, GRID_SIZE)
            pygame.draw.rect(screen, piece["color"], rect)  # Zeichne das Quadrat
            pygame.draw.rect(screen, BLACK, rect, 1)  # Umrandung

            
def investigate_Game_over():
    """ Prüft, ob der aktuelle Spieler noch einen Stein legen kann. """
    current_pieces = selected_pieces_p1 if player_turn == 1 else selected_pieces_p2

    if not current_pieces:
        return False  # Wenn keine Steine ausgewählt sind, ist das Spiel nicht vorbei

    for piece in current_pieces:
        original_shape = piece["shape"][:]
        
        # Prüfe alle Drehungen und Spiegelungen
        for _ in range(2):  # Zwei Iterationen: Original und Spiegelung
            for _ in range(4):  # Vier Iterationen: 0, 90, 180, 270 Grad
                for x in range(BOARD_X, BOARD_X + GRID_COLS * GRID_SIZE, GRID_SIZE):
                    for y in range(BOARD_Y, BOARD_Y + GRID_ROWS * GRID_SIZE, GRID_SIZE):
                        if is_piece_inside_board(piece, (x, y)) and not is_piece_overlapping(piece, (x, y)):
                            return False  # Es gibt eine gültige Position, das Spiel ist nicht vorbei
                rotate_piece(piece)
            mirror_piece(piece)
        
        # Setze die ursprüngliche Form zurück
        piece["shape"] = original_shape[:]
    
    return True  # Kein gültiger Zug gefunden, das Spiel ist vorbei


def is_piece_overlapping(piece, position):
    """ Prüft, ob das gegebene Stück mit einem bereits platzierten Stück kollidiert. """
    px, py = position
    for square in piece["shape"]:
        x, y = px + square[0] * GRID_SIZE, py + square[1] * GRID_SIZE
        for placed_piece in placed_pieces:
            placed_px, placed_py = placed_piece["pos"]
            for placed_square in placed_piece["shape"]:
                placed_x = placed_px + placed_square[0] * GRID_SIZE
                placed_y = placed_py + placed_square[1] * GRID_SIZE
                if pygame.Rect(x, y, GRID_SIZE, GRID_SIZE).colliderect(pygame.Rect(placed_x, placed_y, GRID_SIZE, GRID_SIZE)):
                    return True
    return False


running = True
player_turn = 1  # 1 = Spieler 1, 2 = Spieler 2
draw_phase = True  # True = Ziehphase, False = Platzierungsphase
in_placement_phase = False
selected_pieces_p1 = []  # Gespeicherte Steine von Spieler 1
selected_pieces_p2 = []  # Gespeicherte Steine von Spieler 2

start_time = time.time()

while running:
    screen.fill(WHITE)
    screen.blit(headline_surface, headline_rect)  # Text auf den Bildschirm zeichnen
    draw_grid()
    draw_pieces()
    draw_selected_pieces_p1()
    draw_selected_pieces_p2()
    draw_placed_pieces() 
    draw_player_turn()  # Aktuellen Spieler anzeigen

    # Buchstaben untereinander rendern
    for i, letter in enumerate(player1_text):
        letter_surface = font.render(letter, True, text_color)
        letter_rect = letter_surface.get_rect(center=(player1_x, player_y + i * line_spacing))
        screen.blit(letter_surface, letter_rect)

    for i, letter in enumerate(player2_text):
        letter_surface = font.render(letter, True, text_color)
        letter_rect = letter_surface.get_rect(center=(player2_x, player_y + i * line_spacing))
        screen.blit(letter_surface, letter_rect)

    #  📌 3. Spielende: Es verliert derjenige Spieler, der an der Reihe ist und keinen Stein mehr legen kann
    if not draw_phase and investigate_Game_over():
        reset_rect = draw_winner(f"Spieler {player_turn} hat verloren!")
        draw_winner(f"Spieler {player_turn} hat verloren!")
        pygame.display.flip()
        for event in pygame.event.get():
            if event.type == pygame.QUIT:
                running = False
            elif event.type == pygame.MOUSEBUTTONDOWN:
                x, y = event.pos
                if reset_rect and reset_rect.collidepoint(x, y):
                    reset_game()
                    continue
        continue  # Verhindert das Zeichnen der Handlungsoptionen und andere Logik


    if in_placement_phase:
        draw_ghost_piece(selected_piece)
        draw_actions(["Mausklick auf Stein: Auswahl", "P: Platzieren Ghost-Stein", "0: Abbrechen Ghost-Stein", "Pfeiltasten oder W/A/S/D: Bewegen Ghost-Stein", "R: Drehen", "M: Spiegeln", "Enter: Platzieren-Final"])
    elif draw_phase:
        draw_actions(["Mausklick auf Stein: Auswahl"])
    else:
        draw_actions(["Mausklick auf Stein: Auswahl", "R: Drehen", "M: Spiegeln", "P: Platzieren Ghost-Stein"])
    
    for event in pygame.event.get():
        if event.type == pygame.QUIT:
            running = False
        
        
        elif event.type == pygame.KEYDOWN and ghost_pos:
            gx, gy = ghost_pos
            new_pos = None


            if event.key == pygame.K_LEFT or event.key == pygame.K_a:
                new_pos = (gx - GRID_SIZE, gy)
            elif event.key == pygame.K_RIGHT or event.key == pygame.K_d:
                new_pos = (gx + GRID_SIZE, gy)
            elif event.key == pygame.K_UP or event.key == pygame.K_w:
                new_pos = (gx, gy - GRID_SIZE)
            elif event.key == pygame.K_DOWN or event.key == pygame.K_s:
                new_pos = (gx, gy + GRID_SIZE)
            if event.key == pygame.K_r:
                original_shape = selected_piece["shape"][:]
                rotate_piece(selected_piece)

                # Prüfen, ob nach der Drehung alles im Feld bleibt
                if not is_piece_inside_board(selected_piece, ghost_pos):
                    selected_piece["shape"] = original_shape  # Rückgängig machen  
            elif event.key == pygame.K_m:
                mirror_piece(selected_piece)  
            elif event.key == pygame.K_0:
                in_placement_phase = False
                ghost_pos = None
                break
            elif event.key == pygame.K_RETURN:
                place_piece(selected_piece)
                ghost_pos = None  
                selected_piece = None                
            
            if new_pos:
                new_gx, new_gy = new_pos
                is_valid = True

                for square in selected_piece["shape"]:
                    x = new_gx + square[0] * GRID_SIZE
                    y = new_gy + square[1] * GRID_SIZE

                    if x < BOARD_X or x >= BOARD_X + GRID_COLS * GRID_SIZE or y < BOARD_Y or y >= BOARD_Y + GRID_ROWS * GRID_SIZE:
                        is_valid = False
                        break

                if is_valid:
                    ghost_pos = new_pos  # Nur aktualisieren, wenn gültig

        elif event.type == pygame.MOUSEBUTTONDOWN:
            x, y = event.pos
            
            if draw_phase:  # ZIEH-PHASE
                for piece in pieces:
                    px, py = piece["pos"]
            
                    for square in piece["shape"]:
                        sx, sy = px + square[0] * GRID_SIZE, py + square[1] * GRID_SIZE

                        # Erweitertes Kollisionsrechteck mit einem Rand von einem halben Quadrat
                        expanded_rect = pygame.Rect(sx - GRID_SIZE // 2, sy - GRID_SIZE // 2, GRID_SIZE + GRID_SIZE, GRID_SIZE + GRID_SIZE)
                        
                        if expanded_rect.collidepoint(x, y):
                            selected_piece = piece
                            pieces.remove(piece)  # Entferne den Stein aus der Auswahl, Ziel: plazierung des Steins neben das Spielfeld
                            
                            if player_turn == 1:
                                selected_pieces_p1.append(piece)
                                player_turn = 2  # Nächster Zug für Spieler 2
                            else:
                                selected_pieces_p2.append(piece)
                                player_turn = 1  # Nächster Zug für Spieler 1

                            # Wenn beide Spieler je 6 Steine gewählt haben, endet die Ziehphase
                            if len(selected_pieces_p1) == 6 and len(selected_pieces_p2) == 6:
                                draw_phase = False
                                selected_piece = None
                                player_turn = 2
                            
                            break
            
            else:  # 📌 PLATZIERUNGS-PHASE
                current_pieces = selected_pieces_p1 if player_turn == 1 else selected_pieces_p2
            
                # 📌 1. Falls ein Stein angeklickt wird -> Auswahl
                if ghost_pos == None:
                    for piece in current_pieces:
                        px, py = piece["pos"]
                
                        for square in piece["shape"]:
                            sx, sy = px + square[0] * GRID_SIZE, py + square[1] * GRID_SIZE
                            rect = pygame.Rect(sx - GRID_SIZE // 2, sy - GRID_SIZE // 2, GRID_SIZE + GRID_SIZE, GRID_SIZE + GRID_SIZE)

                            if rect.collidepoint(x, y):
                                selected_piece = piece  # Stein gefunden!
                                break  # Bricht die innere Schleife ab
                
    
        elif event.type == pygame.KEYDOWN and selected_piece:
            #  📌 2. Drehen oder Spiegeln nur in der Platzierungsphase, falls ein Stein ausgewählt ist oder Stein wird auf das Spielfeld gelegt
            if event.key == pygame.K_r:
                rotate_piece(selected_piece)  
            elif event.key == pygame.K_m:
                mirror_piece(selected_piece)   
            elif event.key == pygame.K_p and draw_phase == False:
                in_placement_phase = True
                min_x = min(x for x, y in selected_piece["shape"])
                min_y = min(y for x, y in selected_piece["shape"])

                ghost_x = BOARD_X + (GRID_COLS // 2) * GRID_SIZE - min_x * GRID_SIZE
                ghost_y = BOARD_Y + (GRID_ROWS // 6) * GRID_SIZE - min_y * GRID_SIZE
                ghost_pos = (ghost_x, ghost_y)  # Speichert die neue Position des Ghost Pieces
              


    pygame.display.flip()
    clock.tick(30)


pygame.quit()
sys.exit()


# Neos Farbschema
'''
WHITE = (255, 255, 255)
BLACK = (0, 0, 0)
Burgundy = (139, 0, 50)
RED = (220, 0, 0)
DARK_BLUE = (0, 0, 200)
LIGHT_BLUE = (100, 150, 235)
DARK_GREEN = (0, 180, 0)
LIGHT_GREEN = (0, 230, 0)
YELLOW = (255, 255, 0)
ORANGE = (230, 130, 0)
PINK = (255, 51, 153)
CYAN = (0, 255, 255)
BROWN = (240, 190, 120)
GRAY = (192, 192, 192)
'''