-- Шкала оценки — внутренний контракт радара: любые источники (2ГИС, Яндекс, Google)
-- нормализуются адаптером к 1..5. Это делает боли и доли сопоставимыми между картами.
ALTER TABLE pain_radar_reviews
  ADD CONSTRAINT pain_radar_reviews_rating_check CHECK (rating BETWEEN 1 AND 5);
