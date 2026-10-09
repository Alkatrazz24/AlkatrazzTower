// Petit client HTTP vers la tour Alkatrazz (127.0.0.1). Ne bloque jamais l'editeur : les requetes
// sont asynchrones, expirent au bout de 2 s, et un echec ne fait qu'appeler OnDone(nullptr).

#pragma once

#include "CoreMinimal.h"
#include "Dom/JsonObject.h"

DECLARE_LOG_CATEGORY_EXTERN(LogAlkatrazzTower, Log, All);

namespace TowerClient
{
	using FOnJson = TFunction<void(TSharedPtr<FJsonObject>)>;

	// http://127.0.0.1:<port> ; port = console Tower.Port (4777), ou la variable TOWER_PORT.
	FString BaseUrl();

	// La derniere requete a-t-elle eu une reponse ? (sert a ne loguer qu'aux changements)
	bool IsReachable();

	// Rappels sur le thread de jeu (politique par defaut du module HTTP).
	void Post(const FString& Path, const TSharedRef<FJsonObject>& Body, FOnJson OnDone = nullptr);
	void Get(const FString& Path, FOnJson OnDone);

	FString ToJson(const TSharedRef<FJsonObject>& Object);
}
