#include <stdio.h>
#include <stdint.h>
uint16_t crc16_update(uint16_t crc, uint8_t a)
{
	int i;
	crc ^=(uint16_t) a;
	for (i = 0; i < 8; ++i)
	{
		if (crc & 0x0001)
			crc = (crc >> 1) ^ 0xA001;
			else
		crc = (crc >> 1);
	}
	return crc;
}

int main()
{
    uint16_t crc = 0xFFFF;
    int i =0;
    uint8_t data[] = {0x01, 0x05, 0x00, 0x00, 0xFF, 0x00, 0x00, 0x00}; // Relay 1 ON CMD
    
    if (crc != 0xFFFF)
	{
		crc = 0xFFFF;
	}
				
    for (i = 0; i < 6; i++)
    {
        crc = crc16_update(crc, data[i]); // here crc checksum is calculated and updated.
    }
    printf("CRC: %02x , %02x \n", (crc & 0xFF), (crc >>8));
    data[6] = (crc & 0xFF);
    data[7] = (crc >>8);
    printf("Data: ");
    for(i=0; i<8; i++)
    {
        printf("%02x ", data[i]);
    }
    printf("\n");
    return 0;
}
