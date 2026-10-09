#include "TowerClient.h"

#include "HAL/IConsoleManager.h"
#include "HAL/PlatformMisc.h"
#include "HttpModule.h"
#include "Interfaces/IHttpRequest.h"
#include "Interfaces/IHttpResponse.h"
#include "Policies/CondensedJsonPrintPolicy.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonSerializer.h"
#include "Serialization/JsonWriter.h"

DEFINE_LOG_CATEGORY(LogAlkatrazzTower);

static TAutoConsoleVariable<int32> CVarTowerPort(
	TEXT("Tower.Port"),
	0,
	TEXT("Port de la tour Alkatrazz sur 127.0.0.1. 0 = variable d'environnement TOWER_PORT, sinon 4777."));

static bool GTowerReachable = false;
static bool GTowerEverAnswered = false;

namespace
{
	int32 EnvPort()
	{
		static const int32 Port = FCString::Atoi(*FPlatformMisc::GetEnvironmentVariable(TEXT("TOWER_PORT")));
		return Port;
	}

	// Un seul message par changement d'etat : la tour eteinte ne doit pas inonder le journal.
	void SetReachable(bool bReachable)
	{
		if (!GTowerEverAnswered || bReachable != GTowerReachable)
		{
			UE_LOG(LogAlkatrazzTower, Log, TEXT("Tour Alkatrazz %s sur %s"),
				bReachable ? TEXT("joignable") : TEXT("injoignable (l'editeur fonctionne normalement)"),
				*TowerClient::BaseUrl());
		}
		GTowerReachable = bReachable;
		GTowerEverAnswered = true;
	}

	void Send(const FString& Verb, const FString& Path, const FString& Content, TowerClient::FOnJson OnDone)
	{
		TSharedRef<IHttpRequest, ESPMode::ThreadSafe> Request = FHttpModule::Get().CreateRequest();
		Request->SetURL(TowerClient::BaseUrl() + Path);
		Request->SetVerb(Verb);
		Request->SetTimeout(2.0f);
		if (Verb == TEXT("POST"))
		{
			Request->SetHeader(TEXT("Content-Type"), TEXT("application/json"));
			Request->SetContentAsString(Content);
		}
		Request->OnProcessRequestComplete().BindLambda(
			[OnDone](FHttpRequestPtr, FHttpResponsePtr Response, bool bProcessedSuccessfully)
			{
				TSharedPtr<FJsonObject> Json;
				const bool bAnswered = bProcessedSuccessfully && Response.IsValid() && Response->GetResponseCode() == 200;
				SetReachable(bAnswered);
				if (bAnswered)
				{
					TSharedRef<TJsonReader<TCHAR>> Reader = TJsonReaderFactory<TCHAR>::Create(Response->GetContentAsString());
					if (!FJsonSerializer::Deserialize(Reader, Json))
					{
						Json.Reset();
					}
				}
				if (OnDone)
				{
					OnDone(Json);
				}
			});
		Request->ProcessRequest();
	}
}

FString TowerClient::BaseUrl()
{
	int32 Port = CVarTowerPort.GetValueOnGameThread();
	if (Port <= 0)
	{
		Port = EnvPort() > 0 ? EnvPort() : 4777;
	}
	return FString::Printf(TEXT("http://127.0.0.1:%d"), Port);
}

bool TowerClient::IsReachable()
{
	return GTowerReachable;
}

FString TowerClient::ToJson(const TSharedRef<FJsonObject>& Object)
{
	FString Out;
	TSharedRef<TJsonWriter<TCHAR, TCondensedJsonPrintPolicy<TCHAR>>> Writer =
		TJsonWriterFactory<TCHAR, TCondensedJsonPrintPolicy<TCHAR>>::Create(&Out);
	const TSharedPtr<FJsonObject> AsPtr = Object;
	FJsonSerializer::Serialize(AsPtr, Writer); // ferme l'ecrivain, ce qui remplit Out
	return Out;
}

void TowerClient::Post(const FString& Path, const TSharedRef<FJsonObject>& Body, FOnJson OnDone)
{
	Send(TEXT("POST"), Path, ToJson(Body), MoveTemp(OnDone));
}

void TowerClient::Get(const FString& Path, FOnJson OnDone)
{
	Send(TEXT("GET"), Path, FString(), MoveTemp(OnDone));
}
