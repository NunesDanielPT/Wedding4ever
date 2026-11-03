ALTER TABLE missions
  ADD COLUMN phase text NOT NULL DEFAULT 'envio' CHECK (phase IN ('envio', 'votacao', 'encerrada'));
